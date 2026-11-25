// Recherche et ajout depuis Modrinth (les fichiers restent hébergés chez Modrinth).
const API = 'https://api.modrinth.com/v2';
const TYPES = { mod: 'mod', resourcepack: 'resourcepack', shaderpack: 'shader' };

async function get(path, params) {
  const res = await fetch(`${API}${path}${params ? '?' + new URLSearchParams(params) : ''}`);
  if (!res.ok) throw new Error(`Modrinth : erreur ${res.status}`);
  return res.json();
}

export async function searchModrinth(query, category, version) {
  const facets = [[`project_type:${TYPES[category]}`], [`versions:${version}`]];
  if (category === 'mod') facets.push(['categories:fabric']);
  return (await get('/search', { query, facets: JSON.stringify(facets), limit: 15 })).hits;
}

async function latestVersion(projectId, category, version) {
  const params = { game_versions: JSON.stringify([version]) };
  if (category === 'mod') params.loaders = JSON.stringify(['fabric']);
  const list = await get(`/project/${encodeURIComponent(projectId)}/version`, params);
  list.sort((a, b) => b.date_published.localeCompare(a.date_published));
  return list.find((v) => v.version_type === 'release') || list[0];
}

function row(project, found, category) {
  const file = found.files.find((f) => f.primary) || found.files[0];
  return {
    category, name: project.title, filename: file.filename, url: file.url, storage_path: null,
    sha1: file.hashes.sha1, size: file.size, icon_url: project.icon_url || null,
    project_id: project.id, version_id: found.id,
  };
}

/** Ajoute le projet et ses dépendances obligatoires (ex : Fabric API). */
export async function addFromModrinth(projectId, category, version, files, save, seen = new Set()) {
  if (seen.has(projectId) || files().some((f) => f.project_id === projectId)) return [];
  seen.add(projectId);
  const project = await get(`/project/${encodeURIComponent(projectId)}`);
  const found = await latestVersion(projectId, category, version);
  if (!found) throw new Error(`${project.title} n'a pas de version pour Minecraft ${version}.`);
  const added = [];
  // Les dépendances d'abord : en cas d'échec, le mod principal n'est pas ajouté sans elles.
  if (category === 'mod') {
    for (const dep of found.dependencies.filter((d) => d.dependency_type === 'required' && d.project_id)) {
      added.push(...await addFromModrinth(dep.project_id, 'mod', version, files, save, seen));
    }
  }
  await save({ ...row(project, found, category), description: '' });
  return [...added, project.title];
}

export async function checkUpdates(list, version, files, save) {
  const updated = [];
  for (const file of list.filter((f) => f.project_id)) {
    const found = await latestVersion(file.project_id, file.category, version);
    if (!found || found.id === file.version_id) continue;
    const project = await get(`/project/${encodeURIComponent(file.project_id)}`);
    await save({ ...row(project, found, file.category), id: file.id });
    if (file.category === 'mod') {
      for (const dep of found.dependencies.filter((d) => d.dependency_type === 'required' && d.project_id)) {
        updated.push(...await addFromModrinth(dep.project_id, 'mod', version, files, save));
      }
    }
    updated.push(file.name);
  }
  return updated;
}
