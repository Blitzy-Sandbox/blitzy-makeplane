# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""S3-compatible object storage backend used by Plane for file uploads.

Exports :class:`S3Storage`, a subclass of
``storages.backends.s3boto3.S3Boto3Storage`` that overrides URL generation,
builds its own ``boto3.client`` from environment variables, and exposes
presigned POST/GET URL helpers, metadata lookup, object copy, direct
upload, and batch delete primitives.

Registered as the default Django storage backend by
:mod:`plane.settings.common` via the
``STORAGES["default"]`` key (``common.py:284``). Direct consumers include
``plane.app.views.asset.v2``, ``plane.app.views.issue.attachment``,
``plane.api.views.asset``, ``plane.api.views.issue``,
``plane.space.views.asset``, ``plane.authentication.adapter.base``, and
the background tasks ``plane.bgtasks.copy_s3_object`` and
``plane.bgtasks.storage_metadata_task``.

Credentials and endpoint env vars (read in :meth:`S3Storage.__init__`):
    - ``AWS_ACCESS_KEY_ID`` / ``AWS_SECRET_ACCESS_KEY`` — credentials.
    - ``AWS_S3_BUCKET_NAME`` — bucket holding all Plane uploads.
    - ``AWS_REGION`` — AWS region for non-MinIO deployments.
    - ``AWS_S3_ENDPOINT_URL`` or ``MINIO_ENDPOINT_URL`` — custom endpoint.
    - ``SIGNED_URL_EXPIRATION`` — default TTL (seconds) for presigned URLs
      (defaults to 3600).

MinIO support: when ``USE_MINIO=1`` the client endpoint is rewritten to
the incoming request's host so signed URLs remain reachable from the
browser; when ``MINIO_ENDPOINT_SSL=1`` the protocol is pinned to
``https`` regardless of the request scheme.

Error handling: every boto3 method that can raise ``ClientError`` catches
it, forwards the exception to :func:`plane.utils.exception_logger.log_exception`,
and returns ``None`` or ``False`` to the caller so failures do not crash
request handlers or Celery tasks.
"""

# Python imports
import os
import uuid

# Third party imports
import boto3
from botocore.exceptions import ClientError
from urllib.parse import quote

# Module imports
from plane.utils.exception_logger import log_exception
from storages.backends.s3boto3 import S3Boto3Storage


class S3Storage(S3Boto3Storage):
    """Custom S3/MinIO storage backend with presigned URL helpers.

    Overrides :meth:`url` to return the raw object key (presigned access
    is handled explicitly via :meth:`generate_presigned_url` and
    :meth:`generate_presigned_post`) and builds an explicit
    ``boto3.client`` in :meth:`__init__` so credentials, region, and
    endpoint can be sourced per-request when serving MinIO behind a
    reverse proxy.

    Public methods return ``None`` (for response payloads) or ``False``
    (for boolean operations) on ``ClientError``; the exception is forwarded
    to :func:`plane.utils.exception_logger.log_exception` so observability
    is preserved without surfacing boto3 internals to the caller.
    """

    def url(self, name, parameters=None, expire=None, http_method=None):
        """Return the raw object key so callers route access via presigned URLs.

        The base ``S3Boto3Storage`` implementation would build a direct
        public S3 URL; Plane intentionally suppresses that behaviour so
        every read goes through :meth:`generate_presigned_url` for access
        control.
        """
        return name

    """S3 storage class to generate presigned URLs for S3 objects"""

    def __init__(self, request=None):
        """Build the underlying boto3 S3 client from environment variables.

        When ``USE_MINIO=1`` the endpoint URL is derived from the incoming
        request host (so browser-facing URLs are reachable behind a reverse
        proxy) and the protocol is selected from ``MINIO_ENDPOINT_SSL`` or,
        when that env var is unset, the request scheme. Otherwise the
        endpoint is sourced from ``AWS_S3_ENDPOINT_URL`` (or
        ``MINIO_ENDPOINT_URL``) directly.

        :param request: The current Django request, used only for the
            MinIO host/scheme lookup. May be ``None`` for non-request-bound
            callers such as Celery tasks; in that case ``USE_MINIO=1``
            paths require ``MINIO_ENDPOINT_SSL`` to be set explicitly.
        """
        # Get the AWS credentials and bucket name from the environment
        self.aws_access_key_id = os.environ.get("AWS_ACCESS_KEY_ID")
        # Use the AWS_SECRET_ACCESS_KEY environment variable for the secret key
        self.aws_secret_access_key = os.environ.get("AWS_SECRET_ACCESS_KEY")
        # Use the AWS_S3_BUCKET_NAME environment variable for the bucket name
        self.aws_storage_bucket_name = os.environ.get("AWS_S3_BUCKET_NAME")
        # Use the AWS_REGION environment variable for the region
        self.aws_region = os.environ.get("AWS_REGION")
        # Use the AWS_S3_ENDPOINT_URL environment variable for the endpoint URL
        self.aws_s3_endpoint_url = os.environ.get("AWS_S3_ENDPOINT_URL") or os.environ.get("MINIO_ENDPOINT_URL")
        # Use the SIGNED_URL_EXPIRATION environment variable for the expiration time (default: 3600 seconds)
        self.signed_url_expiration = int(os.environ.get("SIGNED_URL_EXPIRATION", "3600"))

        if os.environ.get("USE_MINIO") == "1":
            # Determine protocol based on environment variable
            if os.environ.get("MINIO_ENDPOINT_SSL") == "1":
                endpoint_protocol = "https"
            else:
                endpoint_protocol = request.scheme if request else "http"
            # Create an S3 client for MinIO
            self.s3_client = boto3.client(
                "s3",
                aws_access_key_id=self.aws_access_key_id,
                aws_secret_access_key=self.aws_secret_access_key,
                region_name=self.aws_region,
                endpoint_url=(f"{endpoint_protocol}://{request.get_host()}" if request else self.aws_s3_endpoint_url),
                config=boto3.session.Config(signature_version="s3v4"),
            )
        else:
            # Create an S3 client
            self.s3_client = boto3.client(
                "s3",
                aws_access_key_id=self.aws_access_key_id,
                aws_secret_access_key=self.aws_secret_access_key,
                region_name=self.aws_region,
                endpoint_url=self.aws_s3_endpoint_url,
                config=boto3.session.Config(signature_version="s3v4"),
            )

    def generate_presigned_post(self, object_name, file_type, file_size, expiration=None):
        """Generate a presigned URL to upload an S3 object."""
        if expiration is None:
            expiration = self.signed_url_expiration
        fields = {"Content-Type": file_type}

        conditions = [
            {"bucket": self.aws_storage_bucket_name},
            ["content-length-range", 1, file_size],
            {"Content-Type": file_type},
        ]

        # Add condition for the object name (key)
        if object_name.startswith("${filename}"):
            conditions.append(["starts-with", "$key", object_name[: -len("${filename}")]])
        else:
            fields["key"] = object_name
            conditions.append({"key": object_name})

        # Generate the presigned POST URL
        try:
            # Generate a presigned URL for the S3 object
            response = self.s3_client.generate_presigned_post(
                Bucket=self.aws_storage_bucket_name,
                Key=object_name,
                Fields=fields,
                Conditions=conditions,
                ExpiresIn=expiration,
            )
        # Handle errors
        except ClientError as e:
            print(f"Error generating presigned POST URL: {e}")
            return None

        return response

    def _get_content_disposition(self, disposition, filename=None):
        """Build a Content-Disposition header value with optional filename encoding."""
        if filename is None:
            filename = uuid.uuid4().hex

        if filename:
            # Encode the filename to handle special characters
            encoded_filename = quote(filename)
            return f"{disposition}; filename*=UTF-8''{encoded_filename}"
        return disposition

    def generate_presigned_url(
        self,
        object_name,
        expiration=None,
        http_method="GET",
        disposition="inline",
        filename=None,
    ):
        """Generate a presigned URL to share an S3 object."""
        if expiration is None:
            expiration = self.signed_url_expiration
        content_disposition = self._get_content_disposition(disposition, filename)
        try:
            response = self.s3_client.generate_presigned_url(
                "get_object",
                Params={
                    "Bucket": self.aws_storage_bucket_name,
                    "Key": str(object_name),
                    "ResponseContentDisposition": content_disposition,
                },
                ExpiresIn=expiration,
                HttpMethod=http_method,
            )
        except ClientError as e:
            log_exception(e)
            return None

        # The response contains the presigned URL
        return response

    def get_object_metadata(self, object_name):
        """Get the metadata for an S3 object."""
        try:
            response = self.s3_client.head_object(Bucket=self.aws_storage_bucket_name, Key=object_name)
        except ClientError as e:
            log_exception(e)
            return None

        return {
            "ContentType": response.get("ContentType"),
            "ContentLength": response.get("ContentLength"),
            "LastModified": (response.get("LastModified").isoformat() if response.get("LastModified") else None),
            "ETag": response.get("ETag"),
            "Metadata": response.get("Metadata", {}),
        }

    def copy_object(self, object_name, new_object_name):
        """Copy an S3 object to a new location."""
        try:
            response = self.s3_client.copy_object(
                Bucket=self.aws_storage_bucket_name,
                CopySource={"Bucket": self.aws_storage_bucket_name, "Key": object_name},
                Key=new_object_name,
            )
        except ClientError as e:
            log_exception(e)
            return None

        return response

    def upload_file(
        self,
        file_obj,
        object_name: str,
        content_type: str = None,
        extra_args: dict = {},
    ) -> bool:
        """Upload a file directly to S3."""
        try:
            if content_type:
                extra_args["ContentType"] = content_type

            self.s3_client.upload_fileobj(
                file_obj,
                self.aws_storage_bucket_name,
                object_name,
                ExtraArgs=extra_args,
            )
            return True
        except ClientError as e:
            log_exception(e)
            return False

    def delete_files(self, object_names):
        """Delete the listed S3 objects in a single batch request."""
        try:
            self.s3_client.delete_objects(
                Bucket=self.aws_storage_bucket_name,
                Delete={"Objects": [{"Key": object_name} for object_name in object_names]},
            )
            return True
        except ClientError as e:
            log_exception(e)
            return False
