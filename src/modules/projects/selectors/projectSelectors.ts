import type { Project, ProjectSort } from '../../../core/contracts/projects';

export function selectProjects(
  projects: readonly Project[],
  search: string,
  sort: ProjectSort,
): Project[] {
  const query = search.trim().toLocaleLowerCase();
  return projects
    .filter((project) =>
      [project.name, project.description, project.branch]
        .filter(Boolean)
        .some((value) => value!.toLocaleLowerCase().includes(query)),
    )
    .sort((left, right) =>
      sort === 'name'
        ? left.name.localeCompare(right.name)
        : right.lastActivityAt.localeCompare(left.lastActivityAt),
    );
}
