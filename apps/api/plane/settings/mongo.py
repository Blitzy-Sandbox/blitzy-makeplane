# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Singleton accessor for an optional MongoDB connection.

MongoDB is a graceful, opt-in integration used by background tasks for
analytics-style and audit-style storage. It is **NOT** required for the
Plane API to boot: when ``MONGO_DB_URL`` or ``MONGO_DB_DATABASE`` are
unset (or unreachable), :class:`MongoConnection` logs a warning and
exposes ``None`` from its accessor methods so callers can short-circuit
on :meth:`MongoConnection.is_configured` rather than handling exceptions.

Documented consumers (from a repository scan of ``MongoConnection``):
    - :mod:`plane.bgtasks.logger_task` — async log shipping to a
      ``logs`` collection.
    - :mod:`plane.bgtasks.cleanup_task` — retention sweep for stored
      records.
    - :mod:`plane.bgtasks.webhook_task` — webhook delivery audit trail.

The connection credentials are read lazily on first instantiation from
``django.conf.settings`` (which sources them from the ``MONGO_DB_URL``
and ``MONGO_DB_DATABASE`` env vars wired in :mod:`plane.settings.common`)
so the import-time contract with the migrator startup sequence is
preserved: this module does NOT establish a connection or read schema
state at import time.
"""

# Django imports
from django.conf import settings
import logging

# Third party imports
from pymongo import MongoClient
from pymongo.database import Database
from pymongo.collection import Collection
from typing import Optional, TypeVar, Type


T = TypeVar("T", bound="MongoConnection")

# Set up logger
logger = logging.getLogger("plane.mongo")


class MongoConnection:
    """
    A singleton class that manages MongoDB connections.

    This class ensures only one MongoDB connection is maintained throughout the application.
    It provides methods to access the MongoDB client, database, and collections.

    Attributes:
        _instance (Optional[MongoConnection]): The singleton instance of this class
        _client (Optional[MongoClient]): The MongoDB client instance
        _db (Optional[Database]): The MongoDB database instance
    """

    _instance: Optional["MongoConnection"] = None
    _client: Optional[MongoClient] = None
    _db: Optional[Database] = None

    def __new__(cls: Type[T]) -> T:
        """
        Create a new instance of MongoConnection if one does not exist.

        Returns:
            MongoConnection: The singleton instance.
        """
        if cls._instance is None:
            cls._instance = super(MongoConnection, cls).__new__(cls)
            try:
                mongo_url = getattr(settings, "MONGO_DB_URL", None)
                mongo_db_database = getattr(settings, "MONGO_DB_DATABASE", None)

                if not mongo_url or not mongo_db_database:
                    logger.warning(
                        "MongoDB connection parameters not configured. MongoDB functionality will be disabled."
                    )
                    return cls._instance

                cls._client = MongoClient(mongo_url)
                cls._db = cls._client[mongo_db_database]

                # Test the connection
                cls._client.server_info()
                logger.info("MongoDB connection established successfully")
            except Exception as e:
                logger.warning(
                    f"Failed to initialize MongoDB connection: {str(e)}. MongoDB functionality will be disabled."
                )
        return cls._instance

    @classmethod
    def get_client(cls) -> Optional[MongoClient]:
        """
        Return the MongoDB client instance.

        Returns:
            Optional[MongoClient]: The MongoDB client instance or None if not configured.
        """
        if cls._client is None:
            cls._instance = cls()
        return cls._client

    @classmethod
    def get_db(cls) -> Optional[Database]:
        """
        Return the MongoDB database instance.

        Returns:
            Optional[Database]: The MongoDB database instance or None if not configured.
        """
        if cls._db is None:
            cls._instance = cls()
        return cls._db

    @classmethod
    def get_collection(cls, collection_name: str) -> Optional[Collection]:
        """
        Return a MongoDB collection by name.

        Args:
            collection_name (str): The name of the collection to retrieve.

        Returns:
            Optional[Collection]: The MongoDB collection instance or None if not configured.
        """
        try:
            db = cls.get_db()
            if db is None:
                logger.warning(f"Cannot access collection '{collection_name}': MongoDB not configured")
                return None
            return db[collection_name]
        except Exception as e:
            logger.warning(f"Failed to access collection '{collection_name}': {str(e)}")
            return None

    @classmethod
    def is_configured(cls) -> bool:
        """
        Check if MongoDB is properly configured and connected.

        Returns:
            bool: True if MongoDB is configured and connected, False otherwise
        """

        if cls._client is None:
            cls._instance = cls()
        return cls._client is not None and cls._db is not None
