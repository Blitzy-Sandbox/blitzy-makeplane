/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Core composition for the create/update work item form rendered inside the issue modal.
 *
 * Rendered purpose: composes the project select, work item type select, work item template select,
 * duplicate-issue UI, optional parent tag, title input, description editor, default properties controls,
 * additional (custom) properties, and footer (create-more toggle + cancel + submit) into the modal body.
 * Wires `react-hook-form` state to MobX-derived project context, template application, and validation.
 *
 * Props (`IssueFormProps`, exported):
 *   - data (Partial<TIssue>, optional): pre-existing or partial work item payload used as form defaults
 *     (also carries `sourceIssueId` for duplicate-source flows)
 *   - issueTitleRef (React.MutableRefObject<HTMLInputElement | null>, required): forwarded ref used by the
 *     base orchestrator to focus the title input after a "create more" submit
 *   - isCreateMoreToggleEnabled (boolean, required): current state of the footer toggle (mirrored from the base)
 *   - onAssetUpload ((assetId: string) => void, required): callback fired when the description editor uploads a
 *     new asset; base orchestrator collects ids to finalize on submit
 *   - onCreateMoreToggleChange ((value: boolean) => void, required): toggle change callback (propagates to base)
 *   - onChange ((formData: Partial<TIssue> | null) => void, optional): dirty-state callback used by
 *     `DraftIssueLayout` to track unsaved changes
 *   - onClose (() => void, required): close-modal callback
 *   - onSubmit ((values: Partial<TIssue>, is_draft_issue?: boolean) => Promise<void>, required): the submit
 *     handler supplied by the base orchestrator
 *   - projectId (string, required): the active project id used as the form default
 *   - isDraft (boolean, required): forwarded to the submit handler; also affects button labels
 *   - moveToIssue (boolean, optional, default=false): when true and editing a draft, exposes the
 *     "Move to project" action
 *   - modalTitle (string, optional): overrides the i18n-derived title; defaults to update / create-a-draft /
 *     create-new-issue based on context
 *   - primaryButtonText ({ default, loading }, optional): overrides the i18n-derived submit-button copy
 *   - isDuplicateModalOpen (boolean, required): controls the duplicate-issues sub-modal
 *   - handleDuplicateIssueModal ((isOpen: boolean) => void, required): toggle callback for the duplicate modal
 *   - handleDraftAndClose (() => void, optional): supplied by `DraftIssueLayout`; saves draft then closes
 *   - isProjectSelectionDisabled (boolean, optional, default=false): locks the project select
 *   - showActionButtons (boolean, optional, default=true): hide footer to embed the form in a custom shell
 *   - dataResetProperties (any[], optional, default=[]): extra dependency keys to re-run the form reset effect
 *     when external `data` changes
 *
 * MobX stores read (via hooks):
 *   - `useIssueModal()` — `workItemTemplateId`, `isApplyingTemplate`, `selectedParentIssue`,
 *     `setWorkItemTemplateId`, `setSelectedParentIssue`, `getIssueTypeIdOnProjectChange`,
 *     `getActiveAdditionalPropertiesLength`, `handlePropertyValuesValidation`,
 *     `handleCreateUpdatePropertyValues`, `handleTemplateChange`
 *   - `useProject()` — `getProjectById` for resolving `projectDetails` from the watched `project_id`
 *   - `useProjectState()` — `getStateById` for resolving the parent issue's state details
 *   - `useIssueDetail()` — `issue.getIssueById` for resolving the parent work item when `parent_id` changes
 *   - `useWorkspaceDraftIssues()` — `moveIssue` for the draft-to-project move action
 *   - `usePlatformOS()` — `isMobile` flag for `getTabIndex(ETabIndices.ISSUE_FORM, isMobile)`
 *   - `useProjectIssueProperties()` — `fetchCycles` for refreshing cycle options when the user switches projects
 *
 * Side effects:
 *   - Template application: `handleTemplateChange({ workspaceSlug, reset, editorRef })` whenever
 *     `workItemTemplateId` changes (resets the form to the template defaults and re-renders the editor).
 *   - Form reset: `reset(...)` on project change (with or without preserving template state), on external
 *     `data` change, and on submit success.
 *   - Cycles refresh: `fetchCycles(workspaceSlug, projectId)` when the user picks a project different from the
 *     route's project.
 *   - Parent-issue resolution: when `parent_id` is set externally but `selectedParentIssue` is not yet
 *     populated, `useEffect` resolves the parent via `getIssueById` + `getProjectById` + `getStateById` and
 *     calls `setSelectedParentIssue(...)`.
 *   - Move flow: `moveIssue(workspaceSlug, data.id, payload)` via `useWorkspaceDraftIssues()` on
 *     "Move to project"; surrounding `handleCreateUpdatePropertyValues({ ..., isDraft: true })` to persist
 *     custom property values during the move.
 *   - Duplicate-issue probing: `useDebouncedDuplicateIssues(...)` from `@/plane-web/hooks` — in this CE
 *     codebase the hook is a stub that returns `{ duplicateIssues: [] }` with no SWR / API call, so the
 *     duplicate-issue UI never surfaces here; the EE build is expected to swap in an active implementation.
 *   - Toasts: `setToast({ type: TOAST_TYPE.ERROR, ... })` for editor-not-ready-to-discard and move-failed cases.
 *   - Submit: invokes the prop-supplied `onSubmit(submitData, is_draft_issue)` and on resolve, resets the
 *     form / re-applies the template (when `isCreateMoreToggleEnabled` and a template is set) or resets to a
 *     blank form otherwise.
 *
 * Imperative DOM / derived-state notes:
 *   - `formRef` + `modalContainerRef` + a `ResizeObserver` keep the modal container height matched to the form
 *     height so duplicate-modal / additional-properties side panels do not desync visually. The `ResizeObserver`
 *     is disconnected on cleanup.
 *   - `editorRef.current?.clearEditor()` is called after a successful submit (or template reset) to wipe the
 *     description editor contents.
 *   - `editorRef.current?.isEditorReadyToDiscard()` is checked before submit to block submits while the editor
 *     has unsaved imperative state.
 *   - `submitData` is built differently for create vs update: create sends the full payload; update sends only
 *     `getChangedIssuefields(formData, dirtyFields)` plus `project_id`, `id`, `type_id`, and a fallback
 *     `description_html` ("<p></p>") when missing.
 *   - The `is_draft` field on `formData` is preserved to support the draft-to-project move flow.
 *   - The `condition` derived value (truthy name OR non-empty description html) gates `onChange(watch())` so
 *     that draft tracking only kicks in for meaningful edits.
 *   - The existing `// TODO: Remove this after the de-dupe feature is implemented` comment is preserved.
 *   - All `useEffect` calls with `// eslint-disable-next-line react-hooks/exhaustive-deps` comments are
 *     deliberate (avoid double-renders / infinite loops) — preserve every existing eslint-disable line verbatim.
 *
 * Architectural notes (per AAP §0.2.2):
 *   - MobX exclusively — store reads above; `observer(...)` wraps the component.
 *   - `react-hook-form` `FormProvider` exposes form context to descendant components in `./components/*`.
 *   - i18n via `@plane/i18n`; submit button + toast copy use translation keys.
 *   - Editor: `EditorRefApi` from `@plane/editor` (internal TipTap wrapper); `editorRef` is the imperative
 *     handle into the rich-text editor.
 *   - Service layer: no direct service-class invocations in this file — all persistence goes through MobX
 *     store actions surfaced by the hooks above (which in turn call `IssueService`, `WorkspaceDraftService`,
 *     etc.). The base orchestrator handles `FileService` calls.
 */

import React, { useState, useRef, useEffect } from "react";
import { observer } from "mobx-react";
import { useParams } from "next/navigation";
import { FormProvider, useForm } from "react-hook-form";
// editor
import { ETabIndices, DEFAULT_WORK_ITEM_FORM_VALUES } from "@plane/constants";
import type { EditorRefApi } from "@plane/editor";
// i18n
import { useTranslation } from "@plane/i18n";
import { Button } from "@plane/propel/button";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import type { TIssue, TWorkspaceDraftIssue } from "@plane/types";
// hooks
import { ToggleSwitch } from "@plane/ui";
import {
  convertWorkItemDataToSearchResponse,
  getUpdateFormDataForReset,
  cn,
  getTextContent,
  getChangedIssuefields,
  getTabIndex,
} from "@plane/utils";
// components
import {
  IssueDefaultProperties,
  IssueDescriptionEditor,
  IssueParentTag,
  IssueProjectSelect,
  IssueTitleInput,
} from "@/components/issues/issue-modal/components";
// helpers
// hooks
import { useIssueModal } from "@/hooks/context/use-issue-modal";
import { useIssueDetail } from "@/hooks/store/use-issue-detail";
import { useProject } from "@/hooks/store/use-project";
import { useProjectState } from "@/hooks/store/use-project-state";
import { useWorkspaceDraftIssues } from "@/hooks/store/workspace-draft";
import { usePlatformOS } from "@/hooks/use-platform-os";
import { useProjectIssueProperties } from "@/hooks/use-project-issue-properties";
// plane web imports
import { DeDupeButtonRoot } from "@/plane-web/components/de-dupe/de-dupe-button";
import { DuplicateModalRoot } from "@/plane-web/components/de-dupe/duplicate-modal";
import { IssueTypeSelect, WorkItemTemplateSelect } from "@/plane-web/components/issues/issue-modal";
import { WorkItemModalAdditionalProperties } from "@/plane-web/components/issues/issue-modal/modal-additional-properties";
import { useDebouncedDuplicateIssues } from "@/plane-web/hooks/use-debounced-duplicate-issues";

export interface IssueFormProps {
  data?: Partial<TIssue>;
  issueTitleRef: React.MutableRefObject<HTMLInputElement | null>;
  isCreateMoreToggleEnabled: boolean;
  onAssetUpload: (assetId: string) => void;
  onCreateMoreToggleChange: (value: boolean) => void;
  onChange?: (formData: Partial<TIssue> | null) => void;
  onClose: () => void;
  onSubmit: (values: Partial<TIssue>, is_draft_issue?: boolean) => Promise<void>;
  projectId: string;
  isDraft: boolean;
  moveToIssue?: boolean;
  modalTitle?: string;
  primaryButtonText?: {
    default: string;
    loading: string;
  };
  isDuplicateModalOpen: boolean;
  handleDuplicateIssueModal: (isOpen: boolean) => void;
  handleDraftAndClose?: () => void;
  isProjectSelectionDisabled?: boolean;
  showActionButtons?: boolean;
  dataResetProperties?: any[];
}

export const IssueFormRoot = observer(function IssueFormRoot(props: IssueFormProps) {
  const { t } = useTranslation();
  const {
    data,
    issueTitleRef,
    onAssetUpload,
    onChange,
    onClose,
    onSubmit,
    projectId: defaultProjectId,
    isCreateMoreToggleEnabled,
    onCreateMoreToggleChange,
    isDraft,
    moveToIssue = false,
    modalTitle = `${data?.id ? t("update") : isDraft ? t("create_a_draft") : t("create_new_issue")}`,
    primaryButtonText = {
      default: `${data?.id ? t("update") : isDraft ? t("save_to_drafts") : t("save")}`,
      loading: `${data?.id ? t("updating") : t("saving")}`,
    },
    isDuplicateModalOpen,
    handleDuplicateIssueModal,
    handleDraftAndClose,
    isProjectSelectionDisabled = false,
    showActionButtons = true,
    dataResetProperties = [],
  } = props;

  // states
  const [gptAssistantModal, setGptAssistantModal] = useState(false);
  const [isMoving, setIsMoving] = useState<boolean>(false);

  // refs
  const editorRef = useRef<EditorRefApi>(null);
  const submitBtnRef = useRef<HTMLButtonElement | null>(null);
  const formRef = useRef<HTMLFormElement | null>(null);
  const modalContainerRef = useRef<HTMLDivElement | null>(null);

  // router
  const { workspaceSlug, projectId: routeProjectId } = useParams();

  // store hooks
  const { getProjectById } = useProject();
  const {
    workItemTemplateId,
    isApplyingTemplate,
    selectedParentIssue,
    setWorkItemTemplateId,
    setSelectedParentIssue,
    getIssueTypeIdOnProjectChange,
    getActiveAdditionalPropertiesLength,
    handlePropertyValuesValidation,
    handleCreateUpdatePropertyValues,
    handleTemplateChange,
  } = useIssueModal();
  const { isMobile } = usePlatformOS();
  const { moveIssue } = useWorkspaceDraftIssues();

  const {
    issue: { getIssueById },
  } = useIssueDetail();
  const { fetchCycles } = useProjectIssueProperties();
  const { getStateById } = useProjectState();

  // form info
  const methods = useForm<TIssue>({
    defaultValues: { ...DEFAULT_WORK_ITEM_FORM_VALUES, project_id: defaultProjectId, ...data },
    reValidateMode: "onChange",
  });
  const {
    formState,
    formState: { isDirty, isSubmitting, dirtyFields },
    handleSubmit,
    reset,
    watch,
    control,
    getValues,
    setValue,
  } = methods;

  const projectId = watch("project_id");
  const activeAdditionalPropertiesLength = getActiveAdditionalPropertiesLength({
    projectId: projectId,
    workspaceSlug: workspaceSlug?.toString(),
    watch: watch,
  });

  // derived values
  const projectDetails = projectId ? getProjectById(projectId) : undefined;
  const isDisabled = isSubmitting || isApplyingTemplate;

  const { getIndex } = getTabIndex(ETabIndices.ISSUE_FORM, isMobile);

  //reset few fields on projectId change
  useEffect(() => {
    if (isDirty) {
      if (workItemTemplateId) {
        // reset work item template id
        setWorkItemTemplateId(null);
        reset({ ...DEFAULT_WORK_ITEM_FORM_VALUES, project_id: projectId });
        editorRef.current?.clearEditor();
      } else {
        reset(getUpdateFormDataForReset(projectId, getValues()));
      }
    }
    if (projectId && routeProjectId !== projectId) fetchCycles(workspaceSlug?.toString(), projectId);

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  // Reset form when data prop changes
  useEffect(() => {
    if (data) {
      reset({ ...DEFAULT_WORK_ITEM_FORM_VALUES, project_id: projectId, ...data });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...dataResetProperties]);

  // Update the issue type id when the project id changes
  useEffect(() => {
    const issueTypeId = watch("type_id");

    // if issue type id is present or project not available, return
    if (issueTypeId || !projectId) return;

    // get issue type id on project change
    const issueTypeIdOnProjectChange = getIssueTypeIdOnProjectChange(projectId);
    if (issueTypeIdOnProjectChange) setValue("type_id", issueTypeIdOnProjectChange, { shouldValidate: true });

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, projectId]);

  useEffect(() => {
    if (workItemTemplateId && editorRef.current) {
      handleTemplateChange({
        workspaceSlug: workspaceSlug?.toString(),
        reset,
        editorRef,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workItemTemplateId]);

  const handleFormSubmit = async (formData: Partial<TIssue>, is_draft_issue = false) => {
    // Check if the editor is ready to discard
    if (!editorRef.current?.isEditorReadyToDiscard()) {
      setToast({
        type: TOAST_TYPE.ERROR,
        title: t("error"),
        message: t("editor_is_not_ready_to_discard_changes"),
      });
      return;
    }

    // check for required properties validation
    if (
      !handlePropertyValuesValidation({
        projectId: projectId,
        workspaceSlug: workspaceSlug?.toString(),
        watch: watch,
      })
    )
      return;

    const submitData = !data?.id
      ? formData
      : {
          ...getChangedIssuefields(formData, dirtyFields as { [key: string]: boolean | undefined }),
          project_id: getValues<"project_id">("project_id"),
          id: data.id,
          description_html: formData.description_html ?? "<p></p>",
          type_id: getValues<"type_id">("type_id"),
        };

    // this condition helps to move the issues from draft to project issues
    if (formData.hasOwnProperty("is_draft")) submitData.is_draft = formData.is_draft;

    await onSubmit(submitData, is_draft_issue)
      .then(() => {
        setGptAssistantModal(false);
        if (isCreateMoreToggleEnabled && workItemTemplateId) {
          handleTemplateChange({
            workspaceSlug: workspaceSlug?.toString(),
            reset,
            editorRef,
          });
        } else {
          reset({
            ...DEFAULT_WORK_ITEM_FORM_VALUES,
            ...(isCreateMoreToggleEnabled ? { ...data } : {}),
            project_id: getValues<"project_id">("project_id"),
            type_id: getValues<"type_id">("type_id"),
            description_html: data?.description_html ?? "<p></p>",
          });
          editorRef?.current?.clearEditor();
        }
      })
      .catch((error) => {
        console.error(error);
      });
  };

  const handleMoveToProjects = async () => {
    if (!data?.id || !data?.project_id || !data) return;
    setIsMoving(true);
    try {
      await handleCreateUpdatePropertyValues({
        issueId: data.id,
        issueTypeId: data.type_id,
        projectId: data.project_id,
        workspaceSlug: workspaceSlug?.toString(),
        isDraft: true,
      });

      await moveIssue(workspaceSlug.toString(), data.id, {
        ...data,
        ...getValues(),
      } as TWorkspaceDraftIssue);
    } catch {
      setToast({
        type: TOAST_TYPE.ERROR,
        title: "Error!",
        message: "Failed to move work item to project. Please try again.",
      });
    } finally {
      setIsMoving(false);
    }
  };

  const condition =
    (watch("name") && watch("name") !== "") || (watch("description_html") && watch("description_html") !== "<p></p>");

  const handleFormChange = () => {
    if (!onChange) return;

    if (isDirty && condition) onChange(watch());
    else onChange(null);
  };

  // debounced duplicate issues swr
  const { duplicateIssues } = useDebouncedDuplicateIssues(
    workspaceSlug?.toString(),
    projectDetails?.workspace.toString(),
    projectId ?? undefined,
    {
      name: watch("name"),
      description_html: getTextContent(watch("description_html")),
      issueId: data?.id,
    }
  );

  // executing this useEffect when the parent_id coming from the component prop
  useEffect(() => {
    const parentId = watch("parent_id") || undefined;
    if (!parentId) return;
    if (parentId === selectedParentIssue?.id || selectedParentIssue) return;

    const issue = getIssueById(parentId);
    if (!issue) return;

    const projectDetails = getProjectById(issue.project_id);
    if (!projectDetails) return;

    const stateDetails = getStateById(issue.state_id);

    setSelectedParentIssue(
      convertWorkItemDataToSearchResponse(workspaceSlug?.toString(), issue, projectDetails, stateDetails)
    );
  }, [watch, getIssueById, getProjectById, selectedParentIssue, getStateById]);

  // executing this useEffect when isDirty changes
  useEffect(() => {
    if (!onChange) return;

    if (isDirty && condition) onChange(watch());
    else onChange(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDirty]);

  useEffect(() => {
    const formElement = formRef?.current;
    const modalElement = modalContainerRef?.current;

    if (!formElement || !modalElement) return;

    const resizeObserver = new ResizeObserver(() => {
      modalElement.style.maxHeight = `${formElement?.offsetHeight}px`;
    });

    resizeObserver.observe(formElement);

    return () => {
      resizeObserver.disconnect();
    };
  }, [formRef, modalContainerRef]);

  // TODO: Remove this after the de-dupe feature is implemented

  const shouldRenderDuplicateModal = isDuplicateModalOpen && duplicateIssues?.length > 0;

  return (
    <FormProvider {...methods}>
      <div className="flex gap-2 bg-transparent">
        <div className="w-full rounded-lg">
          <form
            ref={formRef}
            onSubmit={handleSubmit((data) => handleFormSubmit(data))}
            className="flex w-full flex-col"
          >
            <div className="rounded-t-lg bg-surface-1 p-5">
              <h3 className="pb-2 text-h4-medium text-secondary">{modalTitle}</h3>
              <div className="flex items-center justify-between pt-2 pb-4">
                <div className="flex items-center gap-x-1">
                  <IssueProjectSelect
                    control={control}
                    disabled={!!data?.id || !!data?.sourceIssueId || isProjectSelectionDisabled}
                    handleFormChange={handleFormChange}
                  />
                  {projectId && (
                    <IssueTypeSelect
                      control={control}
                      projectId={projectId}
                      editorRef={editorRef}
                      disabled={!!data?.sourceIssueId}
                      handleFormChange={handleFormChange}
                      renderChevron
                    />
                  )}
                  {projectId && !data?.id && !data?.sourceIssueId && (
                    <WorkItemTemplateSelect
                      projectId={projectId}
                      typeId={watch("type_id")}
                      handleModalClose={() => {
                        if (handleDraftAndClose) {
                          handleDraftAndClose();
                        } else {
                          onClose();
                        }
                      }}
                      handleFormChange={handleFormChange}
                      renderChevron
                    />
                  )}
                </div>
                {duplicateIssues.length > 0 && (
                  <DeDupeButtonRoot
                    workspaceSlug={workspaceSlug?.toString()}
                    isDuplicateModalOpen={isDuplicateModalOpen}
                    label={
                      duplicateIssues.length === 1
                        ? `${duplicateIssues.length} ${t("duplicate_issue_found")}`
                        : `${duplicateIssues.length} ${t("duplicate_issues_found")}`
                    }
                    handleOnClick={() => handleDuplicateIssueModal(!isDuplicateModalOpen)}
                  />
                )}
              </div>
              {watch("parent_id") && selectedParentIssue && (
                <div className="pb-4">
                  <IssueParentTag
                    control={control}
                    selectedParentIssue={selectedParentIssue}
                    handleFormChange={handleFormChange}
                    setSelectedParentIssue={setSelectedParentIssue}
                  />
                </div>
              )}
              <div className="space-y-1">
                <IssueTitleInput
                  control={control}
                  issueTitleRef={issueTitleRef}
                  formState={formState}
                  handleFormChange={handleFormChange}
                />
              </div>
            </div>
            <div
              className={cn(
                "space-y-3 bg-surface-1 pb-4",
                activeAdditionalPropertiesLength > 4 &&
                  "vertical-scrollbar scrollbar-sm max-h-[45vh] overflow-hidden overflow-y-auto"
              )}
            >
              <div className="px-5">
                <IssueDescriptionEditor
                  control={control}
                  isDraft={isDraft}
                  issueName={watch("name")}
                  issueId={data?.id}
                  descriptionHtmlData={data?.description_html}
                  editorRef={editorRef}
                  submitBtnRef={submitBtnRef}
                  gptAssistantModal={gptAssistantModal}
                  workspaceSlug={workspaceSlug?.toString()}
                  projectId={projectId}
                  handleFormChange={handleFormChange}
                  handleDescriptionHTMLDataChange={(description_html) =>
                    setValue<"description_html">("description_html", description_html)
                  }
                  setGptAssistantModal={setGptAssistantModal}
                  handleGptAssistantClose={() => reset(getValues())}
                  onAssetUpload={onAssetUpload}
                  onClose={onClose}
                />
              </div>
              <WorkItemModalAdditionalProperties
                isDraft={isDraft}
                workItemId={data?.id ?? data?.sourceIssueId}
                projectId={projectId}
                workspaceSlug={workspaceSlug?.toString()}
              />
            </div>
            <div
              className={cn(
                "rounded-b-lg border-t-[0.5px] border-subtle bg-surface-1 px-4 py-3",
                activeAdditionalPropertiesLength > 0 && "shadow-raised-100"
              )}
            >
              <div className="pb-3">
                <IssueDefaultProperties
                  control={control}
                  id={data?.id}
                  projectId={projectId}
                  workspaceSlug={workspaceSlug?.toString()}
                  selectedParentIssue={selectedParentIssue}
                  startDate={watch("start_date")}
                  targetDate={watch("target_date")}
                  parentId={watch("parent_id")}
                  isDraft={isDraft}
                  handleFormChange={handleFormChange}
                  setSelectedParentIssue={setSelectedParentIssue}
                />
              </div>
              {showActionButtons && (
                <div
                  className="flex items-center justify-end gap-4 border-t-[0.5px] border-subtle pt-6 pb-3"
                  tabIndex={getIndex("create_more")}
                >
                  {!data?.id && (
                    <div
                      className="inline-flex cursor-pointer items-center gap-1.5"
                      onClick={() => onCreateMoreToggleChange(!isCreateMoreToggleEnabled)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") onCreateMoreToggleChange(!isCreateMoreToggleEnabled);
                      }}
                      role="button"
                    >
                      <ToggleSwitch value={isCreateMoreToggleEnabled} onChange={() => {}} size="sm" />
                      <span className="text-caption-sm-regular">{t("create_more")}</span>
                    </div>
                  )}
                  <div className="flex items-center gap-2">
                    <div tabIndex={getIndex("discard_button")}>
                      <Button
                        variant="secondary"
                        size="lg"
                        onClick={() => {
                          if (editorRef.current?.isEditorReadyToDiscard()) {
                            onClose();
                          } else {
                            setToast({
                              type: TOAST_TYPE.ERROR,
                              title: "Error!",
                              message: "Editor is still processing changes. Please wait before proceeding.",
                            });
                          }
                        }}
                      >
                        {t("discard")}
                      </Button>
                    </div>
                    <div tabIndex={isDraft ? getIndex("submit_button") : getIndex("draft_button")}>
                      <Button
                        variant={moveToIssue ? "secondary" : "primary"}
                        size="lg"
                        type="submit"
                        ref={submitBtnRef}
                        loading={isSubmitting}
                        disabled={isDisabled}
                      >
                        {isSubmitting ? primaryButtonText.loading : primaryButtonText.default}
                      </Button>
                    </div>

                    {moveToIssue && (
                      <Button
                        variant="primary"
                        type="button"
                        loading={isMoving}
                        onClick={handleMoveToProjects}
                        disabled={isMoving}
                        size="lg"
                      >
                        {t("add_to_project")}
                      </Button>
                    )}
                  </div>
                </div>
              )}
            </div>
          </form>
        </div>
        {shouldRenderDuplicateModal && (
          <div
            ref={modalContainerRef}
            className="shadow-xl bg-pi-50 relative flex flex-col gap-2.5 rounded-lg px-3 py-4"
            style={{ maxHeight: formRef?.current?.offsetHeight ? `${formRef.current.offsetHeight}px` : "436px" }}
          >
            <DuplicateModalRoot
              workspaceSlug={workspaceSlug.toString()}
              issues={duplicateIssues}
              handleDuplicateIssueModal={handleDuplicateIssueModal}
            />
          </div>
        )}
      </div>
    </FormProvider>
  );
});
