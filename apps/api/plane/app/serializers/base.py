# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Base serializer classes for the Plane web-client API.

This module defines two abstractions that every other serializer in
:mod:`plane.app.serializers` inherits from:

* :class:`BaseSerializer` -- a thin :class:`rest_framework.serializers.ModelSerializer`
  wrapper that re-declares ``id`` as a primary-key field so per-serializer
  subclasses can override its read/write behavior.
* :class:`DynamicBaseSerializer` -- adds runtime field projection
  (``fields=...``) and nested entity expansion (``expand=...``) via two
  extra constructor kwargs. The expandable relations are enumerated inline
  in :meth:`DynamicBaseSerializer.to_representation`.

These classes are the structural foundation for the entire web-client
serialization layer; downstream serializer modules (``user``, ``workspace``,
``project``, ``state``, ``issue``, ``label``, ``cycle``, ...) all subclass
one of them.
"""

from rest_framework import serializers


class BaseSerializer(serializers.ModelSerializer):
    """Thin ``ModelSerializer`` wrapper that re-declares ``id`` as a primary-key field.

    DRF's default :class:`~rest_framework.serializers.ModelSerializer` binds
    ``id`` to the model's metadata and disallows overriding it in place.
    Re-declaring ``id`` here lets per-serializer subclasses opt into changing
    its read/write semantics (e.g. accepting a client-supplied ``id`` for
    bulk-import flows) without having to fight the default binding.
    """

    id = serializers.PrimaryKeyRelatedField(read_only=True)


class DynamicBaseSerializer(BaseSerializer):
    """Serializer with runtime field projection and nested entity expansion.

    Two extra constructor kwargs are recognised:

    * ``fields`` -- selects a subset of fields to include in the rendered
      payload. Pass a flat list of names (``["id", "name"]``) for a flat
      projection, or include single-key ``{"relation": [<sub_fields>]}``
      dicts to project sub-fields on a nested expansion.
    * ``expand`` -- embeds the related entity's compact serialization in
      place of its FK id. Pass a list of relation attribute names, e.g.
      ``["workspace", "project"]``. Names that are not present in the
      inline ``expansion`` mapper fall back to a ``<expand>_id`` attribute
      lookup on the instance.

    The set of expandable relations is the source of truth defined inline
    in :meth:`to_representation` (the ``expansion`` dict plus the
    ``many=True`` membership list). Extending the API with a new expandable
    relation therefore requires editing both places -- and, if the relation
    is a many-to-many or reverse-FK collection, adding its key to the
    ``many=True`` list so it is serialized as a list rather than a single
    object.
    """

    def __init__(self, *args, **kwargs):
        """Pop the ``fields`` and ``expand`` kwargs, then apply field projection.

        The custom kwargs are consumed locally and never forwarded to the
        DRF ``ModelSerializer`` constructor; the projection itself is
        applied via :meth:`_filter_fields` after ``super().__init__``
        returns. ``self.expand`` is retained on the instance so that
        :meth:`to_representation` can replay the expansion at render time.
        """
        # If 'fields' is provided in the arguments, remove it and store it separately.
        # This is done so as not to pass this custom argument up to the superclass.
        fields = kwargs.pop("fields", [])
        self.expand = kwargs.pop("expand", []) or []
        fields = self.expand

        # Call the initialization of the superclass.
        super().__init__(*args, **kwargs)
        # If 'fields' was provided, filter the fields of the serializer accordingly.
        if fields is not None:
            self.fields = self._filter_fields(fields)

    def _filter_fields(self, fields):
        """Prune ``self.fields`` down to the names listed in ``fields``.

        ``fields`` may contain flat strings (selecting a top-level field) or
        single-key dicts whose value is a list of sub-fields, in which case
        the helper recurses into the nested expansion. Names that are not
        already on the serializer are looked up against the inline
        ``expansion`` mapper below and attached as a sub-serializer.

        The serializer classes referenced by the expansion mapper are
        imported lazily inside the method body to avoid the circular
        dependency that would otherwise arise: every leaf serializer module
        imports from this ``base`` module, and several leaf serializers
        (user, workspace, project, state, issue, label, cycle, ...) are
        themselves entries in the expansion mapper.
        """
        # Check each field_name in the provided fields.
        for field_name in fields:
            # If the field is a dictionary (indicating nested fields),
            # loop through its keys and values.
            if isinstance(field_name, dict):
                for key, value in field_name.items():
                    # If the value of this nested field is a list,
                    # perform a recursive filter on it.
                    if isinstance(value, list):
                        self._filter_fields(self.fields[key], value)

        # Create a list to store allowed fields.
        allowed = []
        for item in fields:
            # If the item is a string, it directly represents a field's name.
            if isinstance(item, str):
                allowed.append(item)
            # If the item is a dictionary, it represents a nested field.
            # Add the key of this dictionary to the allowed list.
            elif isinstance(item, dict):
                allowed.append(list(item.keys())[0])

        for field in allowed:
            if field not in self.fields:
                from . import (
                    WorkspaceLiteSerializer,
                    ProjectLiteSerializer,
                    UserLiteSerializer,
                    StateLiteSerializer,
                    IssueSerializer,
                    LabelSerializer,
                    CycleIssueSerializer,
                    IssueLiteSerializer,
                    IssueRelationSerializer,
                    IntakeIssueLiteSerializer,
                    IssueReactionLiteSerializer,
                    IssueLinkLiteSerializer,
                    RelatedIssueSerializer,
                )

                # Expansion mapper
                expansion = {
                    "user": UserLiteSerializer,
                    "workspace": WorkspaceLiteSerializer,
                    "project": ProjectLiteSerializer,
                    "default_assignee": UserLiteSerializer,
                    "project_lead": UserLiteSerializer,
                    "state": StateLiteSerializer,
                    "created_by": UserLiteSerializer,
                    "issue": IssueSerializer,
                    "actor": UserLiteSerializer,
                    "owned_by": UserLiteSerializer,
                    "members": UserLiteSerializer,
                    "assignees": UserLiteSerializer,
                    "labels": LabelSerializer,
                    "issue_cycle": CycleIssueSerializer,
                    "parent": IssueLiteSerializer,
                    "issue_relation": IssueRelationSerializer,
                    "issue_intake": IntakeIssueLiteSerializer,
                    "issue_related": RelatedIssueSerializer,
                    "issue_reactions": IssueReactionLiteSerializer,
                    "issue_link": IssueLinkLiteSerializer,
                    "sub_issues": IssueLiteSerializer,
                }

            if field not in self.fields and field in expansion:
                self.fields[field] = expansion[field](
                    many=(
                        True
                        if field
                        in [
                            "members",
                            "assignees",
                            "labels",
                            "issue_cycle",
                            "issue_relation",
                            "issue_intake",
                            "issue_reactions",
                            "issue_attachment",
                            "issue_link",
                            "sub_issues",
                            "issue_related",
                        ]
                        else False
                    )
                )

        return self.fields

    def to_representation(self, instance):
        """Render ``instance``, then expand each relation listed in ``self.expand``.

        For every name in ``self.expand`` that is also present on the
        serializer and in the inline ``expansion`` mapper, the FK id in the
        rendered payload is replaced with the related entity's compact
        serialization. Relations whose attribute name appears in the
        ``many=True`` membership list (``members``, ``assignees``,
        ``labels``, ``issue_cycle``, ``issue_relation``, ``issue_intake``,
        ``issue_reactions``, ``issue_attachment``, ``issue_link``,
        ``sub_issues``, ``issue_related``) are serialized as lists; the
        remainder are serialized as single objects. Names listed in
        ``self.expand`` but absent from the mapper fall back to a
        ``<expand>_id`` attribute lookup on the instance.

        ``issue_attachments`` is special-cased: rather than following a
        direct reverse relation it queries :class:`~plane.db.models.FileAsset`
        directly with ``entity_type=FileAsset.EntityTypeContext.ISSUE_ATTACHMENT``
        and ``issue_id=instance.id``. Issue attachments live in the generic
        ``FileAsset`` table keyed by ``(entity_type, issue_id)`` rather than
        via a dedicated FK from ``Issue``, so the standard expansion path
        cannot reach them.

        Serializer classes and :class:`~plane.db.models.FileAsset` are
        imported lazily inside the method body to keep this module free of
        circular dependencies on the leaf serializer modules.
        """
        response = super().to_representation(instance)

        # Ensure 'expand' is iterable before processing
        if self.expand:
            for expand in self.expand:
                if expand in self.fields:
                    # Import all the expandable serializers
                    from . import (
                        WorkspaceLiteSerializer,
                        ProjectLiteSerializer,
                        UserLiteSerializer,
                        StateLiteSerializer,
                        IssueSerializer,
                        LabelSerializer,
                        CycleIssueSerializer,
                        IssueRelationSerializer,
                        IntakeIssueLiteSerializer,
                        IssueLiteSerializer,
                        IssueReactionLiteSerializer,
                        IssueAttachmentLiteSerializer,
                        IssueLinkLiteSerializer,
                        RelatedIssueSerializer,
                    )

                    # Expansion mapper
                    expansion = {
                        "user": UserLiteSerializer,
                        "workspace": WorkspaceLiteSerializer,
                        "project": ProjectLiteSerializer,
                        "default_assignee": UserLiteSerializer,
                        "project_lead": UserLiteSerializer,
                        "state": StateLiteSerializer,
                        "created_by": UserLiteSerializer,
                        "issue": IssueSerializer,
                        "actor": UserLiteSerializer,
                        "owned_by": UserLiteSerializer,
                        "members": UserLiteSerializer,
                        "assignees": UserLiteSerializer,
                        "labels": LabelSerializer,
                        "issue_cycle": CycleIssueSerializer,
                        "parent": IssueLiteSerializer,
                        "issue_relation": IssueRelationSerializer,
                        "issue_intake": IntakeIssueLiteSerializer,
                        "issue_related": RelatedIssueSerializer,
                        "issue_reactions": IssueReactionLiteSerializer,
                        "issue_attachment": IssueAttachmentLiteSerializer,
                        "issue_link": IssueLinkLiteSerializer,
                        "sub_issues": IssueLiteSerializer,
                    }
                    # Check if field in expansion then expand the field
                    if expand in expansion:
                        if isinstance(response.get(expand), list):
                            exp_serializer = expansion[expand](getattr(instance, expand), many=True)
                        else:
                            exp_serializer = expansion[expand](getattr(instance, expand))
                        response[expand] = exp_serializer.data
                    else:
                        # You might need to handle this case differently
                        response[expand] = getattr(instance, f"{expand}_id", None)

            # Check if issue_attachments is in fields or expand
            if "issue_attachments" in self.fields or "issue_attachments" in self.expand:
                # Import the model here to avoid circular imports
                from plane.db.models import FileAsset

                issue_id = getattr(instance, "id", None)

                if issue_id:
                    # Fetch related issue_attachments
                    issue_attachments = FileAsset.objects.filter(
                        issue_id=issue_id,
                        entity_type=FileAsset.EntityTypeContext.ISSUE_ATTACHMENT,
                    )
                    # Serialize issue_attachments and add them to the response
                    response["issue_attachments"] = IssueAttachmentLiteSerializer(issue_attachments, many=True).data
                else:
                    response["issue_attachments"] = []

        return response
