import path from "node:path";
import type { WorkspaceContext } from "../workspaces/types.js";
import {
  createProjectCheckpoint,
  listProjectCheckpoints,
  type CreateProjectCheckpointOptions,
  type CreatedProjectCheckpoint,
  type ProjectCheckpoint,
} from "./checkpoint-service.js";
import { resumeProject } from "./project-capsule.js";
import { reviewWorkspace, type ReviewWorkspaceArgs } from "./project-review.js";
import {
  addProjectTask,
  createProject,
  getProject,
  linkProjectSource,
  listProjects,
  updateProject,
  validateAllProjects,
  validateProject,
  type AddProjectTaskOptions,
  type AddedProjectTask,
  type CreatedProject,
  type CreateProjectOptions,
  type LinkProjectSourceOptions,
  type LoadedProject,
  type ProjectServiceOptions,
  type UpdatedProject,
  type UpdateProjectOptions,
} from "./project-service.js";
import type {
  ProjectCapsule,
  ProjectSummary,
  ProjectValidationResult,
  WorkspaceReviewReport,
} from "./types.js";

type ProjectContextKeys = keyof ProjectServiceOptions;

export type CreateProjectInput = Omit<CreateProjectOptions, ProjectContextKeys>;
export type UpdateProjectInput = Omit<UpdateProjectOptions, ProjectContextKeys>;
export type AddProjectTaskInput = Omit<AddProjectTaskOptions, ProjectContextKeys>;
export type LinkProjectSourceInput = Omit<LinkProjectSourceOptions, ProjectContextKeys>;
export type CreateProjectCheckpointInput = Omit<CreateProjectCheckpointOptions, ProjectContextKeys>;

export interface ProjectApplicationServiceOptions extends ProjectServiceOptions {
  refresh?: () => Promise<void>;
}

export class ProjectApplicationService {
  private readonly repoRoot: string;
  private readonly scanRoots: string[];
  private readonly workspace?: WorkspaceContext;
  private readonly refresh?: () => Promise<void>;

  constructor(options: ProjectApplicationServiceOptions = {}) {
    this.repoRoot = path.resolve(options.repoRoot || process.cwd());
    this.scanRoots = options.scanRoots
      ? [...options.scanRoots]
      : options.workspace
        ? [...options.workspace.scanRoots]
        : ["demo-kb", "kb"];
    this.workspace = options.workspace;
    this.refresh = options.refresh;
  }

  async create(input: CreateProjectInput): Promise<CreatedProject> {
    const result = await createProject({ ...input, ...this.context() });
    await this.refreshAfterMutation(result.dryRun);
    return result;
  }

  async list(): Promise<ProjectSummary[]> {
    return listProjects(this.context());
  }

  async get(projectId: string): Promise<LoadedProject> {
    return getProject(projectId, this.context());
  }

  async validate(projectId: string): Promise<ProjectValidationResult> {
    return validateProject(projectId, this.context());
  }

  async validateAll(): Promise<ProjectValidationResult[]> {
    return validateAllProjects(this.context());
  }

  async update(input: UpdateProjectInput): Promise<UpdatedProject> {
    const result = await updateProject({ ...input, ...this.context() });
    await this.refreshAfterMutation(result.dryRun, result.changed);
    return result;
  }

  async addTask(input: AddProjectTaskInput): Promise<AddedProjectTask> {
    const result = await addProjectTask({ ...input, ...this.context() });
    await this.refreshAfterMutation(result.dryRun, result.changed);
    return result;
  }

  async linkSource(input: LinkProjectSourceInput): Promise<UpdatedProject> {
    const result = await linkProjectSource({ ...input, ...this.context() });
    await this.refreshAfterMutation(result.dryRun, result.changed);
    return result;
  }

  async createCheckpoint(input: CreateProjectCheckpointInput): Promise<CreatedProjectCheckpoint> {
    const result = await createProjectCheckpoint({ ...input, ...this.context() });
    await this.refreshAfterMutation(result.dryRun);
    return result;
  }

  async listCheckpoints(projectId: string): Promise<ProjectCheckpoint[]> {
    return listProjectCheckpoints(projectId, this.context());
  }

  async review(
    input: ReviewWorkspaceArgs = {},
  ): Promise<{ contentText: string; structured: WorkspaceReviewReport }> {
    return reviewWorkspace(input, this.repoRoot, [...this.scanRoots], this.workspace);
  }

  async resume(projectId: string): Promise<{ contentText: string; structured: ProjectCapsule }> {
    return resumeProject({ projectId }, this.repoRoot, [...this.scanRoots], this.workspace);
  }

  private context(): Required<Pick<ProjectServiceOptions, "repoRoot" | "scanRoots">> &
    Pick<ProjectServiceOptions, "workspace"> {
    return {
      repoRoot: this.repoRoot,
      scanRoots: [...this.scanRoots],
      workspace: this.workspace,
    };
  }

  private async refreshAfterMutation(dryRun: boolean, changed = true): Promise<void> {
    if (!dryRun && changed && this.refresh) await this.refresh();
  }
}

export function createProjectApplicationService(
  options: ProjectApplicationServiceOptions = {},
): ProjectApplicationService {
  return new ProjectApplicationService(options);
}
