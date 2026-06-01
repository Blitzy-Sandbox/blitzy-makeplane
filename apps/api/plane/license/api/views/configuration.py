# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Endpoints for reading, writing, and probing instance configuration.

Drives the admin console's settings panel: bulk reads/writes of
``InstanceConfiguration`` rows, a kill-switch for the email feature, and
a live SMTP credential check. Encrypted configuration values
(``is_encrypted=True``) are Fernet-encrypted on write by ``encrypt_data``
and decrypted on read inside ``InstanceConfigurationSerializer``. The
migrator container is responsible for seeding the
``InstanceConfiguration`` rows before this module is reachable.
"""

# Python imports
from smtplib import (
    SMTPAuthenticationError,
    SMTPConnectError,
    SMTPRecipientsRefused,
    SMTPSenderRefused,
    SMTPServerDisconnected,
)

# Django imports
from django.core.mail import BadHeaderError, EmailMultiAlternatives, get_connection
from django.db.models import Q, Case, When, Value

# Third party imports
from rest_framework import status
from rest_framework.response import Response

# Module imports
from .base import BaseAPIView
from plane.license.api.permissions import InstanceAdminPermission
from plane.license.models import InstanceConfiguration
from plane.license.api.serializers import InstanceConfigurationSerializer
from plane.license.utils.encryption import encrypt_data
from plane.utils.cache import cache_response, invalidate_cache
from plane.license.utils.instance_value import get_email_configuration


class InstanceConfigurationEndpoint(BaseAPIView):
    """Bulk read and write ``InstanceConfiguration`` key/value rows.

    HTTP methods + URL patterns:
        GET   /api/instances/configurations/
        PATCH /api/instances/configurations/

    Request body (PATCH):
        Mapping of ``{key: value}`` pairs (``dict``). Only rows whose
        ``key`` already exists in the table are updated — unknown keys
        are silently ignored. Values targeting rows with
        ``is_encrypted=True`` are Fernet-encrypted via ``encrypt_data``
        before persistence.

    Response shape:
        GET 200: list of ``InstanceConfigurationSerializer`` payloads —
            ``to_representation`` transparently DECRYPTS values for any
            row with ``is_encrypted=True`` so the admin sees plaintext.
        PATCH 200: list of ``InstanceConfigurationSerializer`` payloads
            reflecting the updated rows (with the same decryption
            behaviour applied).

    Permissions:
        ``permission_classes = [InstanceAdminPermission]``.

    Caching:
        GET wraps a 2-hour server-side cache (``cache_response(60*60*2,
        user=False)``).
        PATCH invalidates BOTH ``/api/instances/configurations/`` AND
        ``/api/instances/`` because instance-summary responses re-read
        feature flags from the configuration table.

    Notes:
        Extends the local ``BaseAPIView`` (``views/base.py``);
        ``get_queryset`` is not overridden. Update uses
        ``bulk_update(..., ["value"], batch_size=100)`` so write order
        is not preserved across the input dict, but final state is.
        ``None`` input values are coerced to empty string (``""``);
        other values are stringified and stripped before encryption.
    """

    permission_classes = [InstanceAdminPermission]

    @cache_response(60 * 60 * 2, user=False)
    def get(self, request):
        """Return all ``InstanceConfiguration`` rows with encrypted values decrypted."""
        instance_configurations = InstanceConfiguration.objects.all()
        serializer = InstanceConfigurationSerializer(instance_configurations, many=True)
        return Response(serializer.data, status=status.HTTP_200_OK)

    @invalidate_cache(path="/api/instances/configurations/", user=False)
    @invalidate_cache(path="/api/instances/", user=False)
    def patch(self, request):
        """Bulk-update existing configuration rows; encrypt values for ``is_encrypted`` keys."""
        configurations = InstanceConfiguration.objects.filter(key__in=request.data.keys())

        bulk_configurations = []
        for configuration in configurations:
            raw_value = request.data.get(configuration.key, configuration.value)
            value = "" if raw_value is None else str(raw_value).strip()
            if configuration.is_encrypted:
                configuration.value = encrypt_data(value)
            else:
                configuration.value = value
            bulk_configurations.append(configuration)

        InstanceConfiguration.objects.bulk_update(bulk_configurations, ["value"], batch_size=100)

        serializer = InstanceConfigurationSerializer(configurations, many=True)
        return Response(serializer.data, status=status.HTTP_200_OK)


class DisableEmailFeatureEndpoint(BaseAPIView):
    """Reset the SMTP configuration keys to disable the email feature.

    HTTP methods + URL patterns:
        DELETE /api/instances/configurations/disable-email-feature/

    Request body:
        Empty.

    Response shape:
        200: empty body on success.
        400: ``{"error": "Failed to disable email configuration"}`` if
            the bulk update raises any exception.

    Permissions:
        ``permission_classes = [InstanceAdminPermission]``.

    Caching:
        DELETE invalidates ``/api/instances/`` so the next ``GET
        /api/instances/`` recomputes ``is_smtp_configured`` to ``False``.

    Side effects:
        Clears the six configuration rows that drive SMTP — uses a
        single ``UPDATE ... SET value = CASE ...`` statement:
            ``ENABLE_SMTP`` -> ``"0"``
            ``EMAIL_HOST``, ``EMAIL_HOST_USER``, ``EMAIL_HOST_PASSWORD``,
                ``EMAIL_PORT``, ``EMAIL_FROM`` -> ``""``

    Notes:
        Extends the local ``BaseAPIView`` (``views/base.py``);
        ``get_queryset`` is not overridden. Idempotent — repeated
        DELETEs leave the table in the same disabled state.
        Routed to ``DELETE`` (not ``POST``) because the operation is a
        deletion-of-state semantically.
    """

    permission_classes = [InstanceAdminPermission]

    @invalidate_cache(path="/api/instances/", user=False)
    def delete(self, request):
        """Clear the 6 SMTP-related ``InstanceConfiguration`` rows in one bulk UPDATE."""
        try:
            InstanceConfiguration.objects.filter(
                Q(
                    key__in=[
                        "EMAIL_HOST",
                        "EMAIL_HOST_USER",
                        "EMAIL_HOST_PASSWORD",
                        "ENABLE_SMTP",
                        "EMAIL_PORT",
                        "EMAIL_FROM",
                    ]
                )
            ).update(value=Case(When(key="ENABLE_SMTP", then=Value("0")), default=Value("")))
            return Response(status=status.HTTP_200_OK)
        except Exception:
            return Response(
                {"error": "Failed to disable email configuration"},
                status=status.HTTP_400_BAD_REQUEST,
            )


class EmailCredentialCheckEndpoint(BaseAPIView):
    """Send a test SMTP message using the current ``InstanceConfiguration`` credentials.

    HTTP methods + URL patterns:
        POST /api/instances/email-credentials-check/

    Request body (POST):
        receiver_email (str, required): destination email for the test.

    Response shape:
        200: ``{"message": "Email successfully sent."}``.
        400: ``{"error": "Receiver email is required"}`` when
            ``receiver_email`` is missing.
        400: ``{"error": <diagnostic>}`` mapped per exception:
            ``BadHeaderError``        -> "Invalid email header."
            ``SMTPAuthenticationError`` -> "Invalid credentials provided"
            ``SMTPConnectError``     -> "Could not connect with the SMTP server."
            ``SMTPSenderRefused``    -> "From address is invalid."
            ``SMTPServerDisconnected`` -> "SMTP server disconnected unexpectedly."
            ``SMTPRecipientsRefused`` -> "All recipient addresses were refused."
            ``TimeoutError``         -> "Timeout error while trying to connect to the SMTP server."
            ``ConnectionError``      -> "Network connection error. Please check your internet connection."
            ``Exception`` (catch-all) -> "Could not send email. Please check your configuration"

    Permissions:
        Inherits the local ``BaseAPIView`` default
        ``permission_classes = [InstanceAdminPermission]`` — the class
        does not override it.

    Side effects:
        Sends a single test email via Django's mail backend over an SMTP
        connection built from
        ``plane.license.utils.instance_value.get_email_configuration``.
        Reads decrypted values from ``InstanceConfiguration``; no DB
        writes are performed.

    Notes:
        Extends the local ``BaseAPIView`` (``views/base.py``);
        ``get_queryset`` is not overridden. Idempotent at the API
        level, although every successful call delivers an additional
        test email — callers should treat repeated POSTs as
        observationally meaningful.
    """

    def post(self, request):
        """Build an SMTP connection from configuration and send a test ``EmailMultiAlternatives``."""
        receiver_email = request.data.get("receiver_email", False)
        if not receiver_email:
            return Response(
                {"error": "Receiver email is required"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        (
            EMAIL_HOST,
            EMAIL_HOST_USER,
            EMAIL_HOST_PASSWORD,
            EMAIL_PORT,
            EMAIL_USE_TLS,
            EMAIL_USE_SSL,
            EMAIL_FROM,
        ) = get_email_configuration()

        # Configure all the connections
        connection = get_connection(
            host=EMAIL_HOST,
            port=int(EMAIL_PORT),
            username=EMAIL_HOST_USER,
            password=EMAIL_HOST_PASSWORD,
            use_tls=EMAIL_USE_TLS == "1",
            use_ssl=EMAIL_USE_SSL == "1",
        )
        # Prepare email details
        subject = "Email Notification from Plane"
        message = "This is a sample email notification sent from Plane application."
        # Send the email
        try:
            msg = EmailMultiAlternatives(
                subject=subject,
                body=message,
                from_email=EMAIL_FROM,
                to=[receiver_email],
                connection=connection,
            )
            msg.send(fail_silently=False)
            return Response({"message": "Email successfully sent."}, status=status.HTTP_200_OK)
        except BadHeaderError:
            return Response({"error": "Invalid email header."}, status=status.HTTP_400_BAD_REQUEST)
        except SMTPAuthenticationError:
            return Response(
                {"error": "Invalid credentials provided"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        except SMTPConnectError:
            return Response(
                {"error": "Could not connect with the SMTP server."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        except SMTPSenderRefused:
            return Response(
                {"error": "From address is invalid."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        except SMTPServerDisconnected:
            return Response(
                {"error": "SMTP server disconnected unexpectedly."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        except SMTPRecipientsRefused:
            return Response(
                {"error": "All recipient addresses were refused."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        except TimeoutError:
            return Response(
                {"error": "Timeout error while trying to connect to the SMTP server."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        except ConnectionError:
            return Response(
                {"error": "Network connection error. Please check your internet connection."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        except Exception:
            return Response(
                {"error": "Could not send email. Please check your configuration"},
                status=status.HTTP_400_BAD_REQUEST,
            )
