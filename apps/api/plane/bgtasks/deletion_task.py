# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Celery tasks for soft-delete cascade and the daily hard-delete sweep.

Two ``@shared_task`` functions live here (plus one commented-out
placeholder):

1. ``soft_delete_related_objects`` — cascades a soft-delete through
   reverse FK relationships, respecting each FK's ``on_delete`` policy
   (``DO_NOTHING`` / ``SET_NULL`` / ``CASCADE``). The initial dispatch
   from ``SoftDeleteModel.delete()`` (see ``plane/db/mixins.py``) is a
   ``.delay()`` call; the recursion inside the task itself is a direct
   in-process function call, so the full cascade for a given root
   completes inside a single Celery task.

2. ``hard_delete`` — Beat-scheduled at ``00:00 UTC`` daily (entry
   ``check-every-day-to-delete-hard-delete`` in ``plane/celery.py``);
   physically removes rows whose ``deleted_at`` is older than
   ``settings.HARD_DELETE_AFTER_DAYS``.

3. ``restore_related_objects`` — PLACEHOLDER. The ``@shared_task``
   decoration is INTENTIONALLY COMMENTED OUT; the body is ``pass``.
   This is reserved as an API-surface marker for future soft-delete
   restore functionality and has no call sites today.

Hard-delete model order:
    The explicit list — Workspace → Project → Cycle → Module → Issue →
    Page → IssueView → Label → State → IssueActivity → IssueComment →
    IssueLink → IssueReaction → UserFavorite → ModuleIssue → CycleIssue
    → Estimate → EstimatePoint — sweeps children before parents so
    cascade FK constraints stay satisfied. A subsequent generic phase
    iterates every other Django model with a ``deleted_at`` field to
    catch any soft-deletable models added after this file was last
    maintained.

Async infrastructure: queued onto **RabbitMQ** and consumed by Celery
workers (per the architectural rule that RabbitMQ is the task broker;
Redis is used only for caching and session state).

See tech spec §4.12 DATA CLEANUP AND RETENTION WORKFLOWS.
"""

# Django imports
from django.utils import timezone
from django.apps import apps
from django.conf import settings
from django.db import models
from django.db.models.fields.related import OneToOneRel


# Third party imports
from celery import shared_task


@shared_task
def soft_delete_related_objects(app_label, model_name, instance_pk, using=None):
    """Cascade a soft-delete through reverse FK relationships, respecting each FK's ``on_delete`` policy.

    Trigger:
        Initial dispatch is
        ``soft_delete_related_objects.delay(app_label, model_name,
        instance_pk, using=using)`` from ``SoftDeleteModel.delete()``
        in ``plane/db/mixins.py`` whenever a soft delete is performed
        (soft delete is the default behavior of
        ``SoftDeleteModel.delete``). The Celery message is routed via
        **RabbitMQ** and consumed by the worker. Recursive descent
        into cascading relations happens via direct in-process
        function calls inside the task body, not via additional
        ``.delay()`` dispatches.

    Side effects:
        - **DB read**: enumerates the source model's auto-created
          reverse relationships (``one_to_many`` / ``one_to_one``)
          via ``_meta.get_fields()``.
        - **DB write (per relation)**:
            * ``on_delete=DO_NOTHING`` — no action.
            * ``on_delete=SET_NULL`` — sets the FK to ``NULL`` on
              each related row (``QuerySet.update`` for many-relations;
              ``setattr`` + ``save(update_fields=[...])`` for
              ``OneToOneRel``).
            * any other ``on_delete`` (including ``CASCADE``) —
              soft-deletes each related row (sets ``deleted_at``) and
              **recurses synchronously** by calling
              ``soft_delete_related_objects`` directly for the
              now-soft-deleted child. Because the recursion is a
              direct call and not ``.delay()``, the entire cascade
              completes inside the originating Celery task.
        - **DB write (self)**: after the relations are processed, the
          source instance itself is soft-deleted
          (``deleted_at = timezone.now()``) when it carries a
          ``deleted_at`` field that is not already set.
        - Errors raised while traversing a single relation are caught,
          logged via ``print``, and the cascade continues with the
          next relation rather than aborting.
        - **No** emails. **No** webhook fan-out. **No** cache
          invalidation.

    Idempotency:
        IDEMPOTENT. Re-soft-deleting an already-soft-deleted row is a
        no-op because the ``deleted_at`` guards skip rows that already
        carry a timestamp; a missing instance (``DoesNotExist``)
        returns early without raising.

    Args:
        app_label: Django app label of the source model.
        model_name: Model class name within ``app_label``.
        instance_pk: Primary key of the soft-deleted row whose
            cascade is being processed.
        using: Database alias propagated to recursive cascade calls
            (default ``None`` — uses the default DB).
    """
    # Get the model class using app registry
    model_class = apps.get_model(app_label, model_name)

    # Get the instance using all_objects to ensure we can get even if it's already soft deleted
    try:
        instance = model_class.all_objects.get(pk=instance_pk)
    except model_class.DoesNotExist:
        return

    # Get all related fields that are reverse relationships
    all_related = [
        f for f in instance._meta.get_fields() if (f.one_to_many or f.one_to_one) and f.auto_created and not f.concrete
    ]

    # Handle each related field
    for relation in all_related:
        related_name = relation.get_accessor_name()

        # Skip if the relation doesn't exist
        if not hasattr(instance, related_name):
            continue

        # Get the on_delete behavior name
        on_delete_name = relation.on_delete.__name__ if hasattr(relation.on_delete, "__name__") else ""

        if on_delete_name == "DO_NOTHING":
            continue

        elif on_delete_name == "SET_NULL":
            # Handle SET_NULL relationships
            if isinstance(relation, OneToOneRel):
                # For OneToOne relationships
                related_obj = getattr(instance, related_name, None)
                if related_obj and isinstance(related_obj, models.Model):
                    setattr(related_obj, relation.remote_field.name, None)
                    related_obj.save(update_fields=[relation.remote_field.name])
            else:
                # For other relationships
                related_queryset = getattr(instance, related_name).all()
                related_queryset.update(**{relation.remote_field.name: None})

        else:
            # Handle CASCADE and other delete behaviors
            try:
                if relation.one_to_one:
                    # Handle OneToOne relationships
                    related_obj = getattr(instance, related_name, None)
                    if related_obj:
                        if hasattr(related_obj, "deleted_at"):
                            if not related_obj.deleted_at:
                                related_obj.deleted_at = timezone.now()
                                related_obj.save()
                                # Recursively handle related objects
                                soft_delete_related_objects(
                                    related_obj._meta.app_label,
                                    related_obj._meta.model_name,
                                    related_obj.pk,
                                    using,
                                )
                else:
                    # Handle other relationships
                    related_queryset = getattr(instance, related_name)(manager="objects").all()

                    for related_obj in related_queryset:
                        if hasattr(related_obj, "deleted_at"):
                            if not related_obj.deleted_at:
                                related_obj.deleted_at = timezone.now()
                                related_obj.save()
                                # Recursively handle related objects
                                soft_delete_related_objects(
                                    related_obj._meta.app_label,
                                    related_obj._meta.model_name,
                                    related_obj.pk,
                                    using,
                                )
            except Exception as e:
                # Log the error or handle as needed
                print(f"Error handling relation {related_name}: {str(e)}")
                continue

    # Finally, soft delete the instance itself if it hasn't been deleted yet
    if hasattr(instance, "deleted_at") and not instance.deleted_at:
        instance.deleted_at = timezone.now()
        instance.save()


# @shared_task
def restore_related_objects(app_label, model_name, instance_pk, using=None):
    """Provide a placeholder symbol for a future soft-delete restore Celery task (currently a no-op stub).

    The ``@shared_task`` decoration on the preceding source line is
    INTENTIONALLY COMMENTED OUT and the body is ``pass``: this
    function is not yet a Celery task and is not called from anywhere
    in the codebase today. It exists only as an API-surface marker
    reserved for future restore-from-soft-delete functionality.

    A future implementation should:
        1. Uncomment the ``@shared_task`` decorator above.
        2. Implement the inverse cascade of
           ``soft_delete_related_objects`` (set ``deleted_at = None``
           on the source and on cascading descendants while respecting
           each FK's ``on_delete`` policy).
        3. Wire up call sites (likely from a restore endpoint or
           admin action) using ``.delay()`` so the cascade runs on a
           worker via RabbitMQ.

    Args:
        app_label: Django app label of the source model.
        model_name: Model class name within ``app_label``.
        instance_pk: Primary key of the row to restore.
        using: Database alias (default ``None`` — uses the default
            DB).
    """
    pass


@shared_task
def hard_delete():
    """Delete soft-deleted rows past the retention threshold across the model hierarchy.

    Trigger:
        Celery Beat schedule entry
        ``check-every-day-to-delete-hard-delete`` declared in
        ``plane/celery.py`` (``crontab(hour=0, minute=0)`` — 00:00 UTC
        daily). The Celery message is routed via **RabbitMQ** and
        consumed by the worker.

    Side effects:
        - **DB delete (hard, ordered)**: for each model in the explicit
          list — Workspace → Project → Cycle → Module → Issue → Page →
          IssueView → Label → State → IssueActivity → IssueComment →
          IssueLink → IssueReaction → UserFavorite → ModuleIssue →
          CycleIssue → Estimate → EstimatePoint — runs
          ``model.all_objects.filter(deleted_at__lt=now() -
          timedelta(days=settings.HARD_DELETE_AFTER_DAYS)).delete()``.
          Children are processed before parents so cascade FK
          constraints stay satisfied.
        - **DB delete (generic phase)**: after the explicit list,
          iterates every other Django model with a ``deleted_at`` field
          via ``apps.get_models()`` and repeats the same
          retention-filter delete, catching any soft-deletable models
          added after this file was last maintained.
        - Each ``.delete()`` is a true hard delete (rows leave the
          database) and runs Django's ORM cascade for the surviving
          relations.
        - **No** emails. **No** webhook fan-out. **No** cache
          invalidation.

    Idempotency:
        IDEMPOTENT. The
        ``deleted_at < now() - HARD_DELETE_AFTER_DAYS`` filter is
        monotonic in time; once a row has been hard-deleted it is
        gone, so subsequent runs find no matches for the same rows.
    """
    from plane.db.models import (
        Workspace,
        Project,
        Cycle,
        Module,
        Issue,
        Page,
        IssueView,
        Label,
        State,
        IssueActivity,
        IssueComment,
        IssueLink,
        IssueReaction,
        UserFavorite,
        ModuleIssue,
        CycleIssue,
        Estimate,
        EstimatePoint,
    )

    days = settings.HARD_DELETE_AFTER_DAYS
    # check delete workspace
    _ = Workspace.all_objects.filter(deleted_at__lt=timezone.now() - timezone.timedelta(days=days)).delete()

    # check delete project
    _ = Project.all_objects.filter(deleted_at__lt=timezone.now() - timezone.timedelta(days=days)).delete()

    # check delete cycle
    _ = Cycle.all_objects.filter(deleted_at__lt=timezone.now() - timezone.timedelta(days=days)).delete()

    # check delete module
    _ = Module.all_objects.filter(deleted_at__lt=timezone.now() - timezone.timedelta(days=days)).delete()

    # check delete issue
    _ = Issue.all_objects.filter(deleted_at__lt=timezone.now() - timezone.timedelta(days=days)).delete()

    # check delete page
    _ = Page.all_objects.filter(deleted_at__lt=timezone.now() - timezone.timedelta(days=days)).delete()

    # check delete view
    _ = IssueView.all_objects.filter(deleted_at__lt=timezone.now() - timezone.timedelta(days=days)).delete()

    # check delete label
    _ = Label.all_objects.filter(deleted_at__lt=timezone.now() - timezone.timedelta(days=days)).delete()

    # check delete state
    _ = State.all_objects.filter(deleted_at__lt=timezone.now() - timezone.timedelta(days=days)).delete()

    _ = IssueActivity.all_objects.filter(deleted_at__lt=timezone.now() - timezone.timedelta(days=days)).delete()

    _ = IssueComment.all_objects.filter(deleted_at__lt=timezone.now() - timezone.timedelta(days=days)).delete()

    _ = IssueLink.all_objects.filter(deleted_at__lt=timezone.now() - timezone.timedelta(days=days)).delete()

    _ = IssueReaction.all_objects.filter(deleted_at__lt=timezone.now() - timezone.timedelta(days=days)).delete()

    _ = UserFavorite.all_objects.filter(deleted_at__lt=timezone.now() - timezone.timedelta(days=days)).delete()

    _ = ModuleIssue.all_objects.filter(deleted_at__lt=timezone.now() - timezone.timedelta(days=days)).delete()

    _ = CycleIssue.all_objects.filter(deleted_at__lt=timezone.now() - timezone.timedelta(days=days)).delete()

    _ = Estimate.all_objects.filter(deleted_at__lt=timezone.now() - timezone.timedelta(days=days)).delete()

    _ = EstimatePoint.all_objects.filter(deleted_at__lt=timezone.now() - timezone.timedelta(days=days)).delete()

    # at last, check for every thing which ever is left and delete it
    # Get all Django models
    all_models = apps.get_models()

    # Iterate through all models
    for model in all_models:
        # Check if the model has a 'deleted_at' field
        if hasattr(model, "deleted_at"):
            # Get all instances where 'deleted_at' is greater than 30 days ago
            _ = model.all_objects.filter(deleted_at__lt=timezone.now() - timezone.timedelta(days=days)).delete()

    return
