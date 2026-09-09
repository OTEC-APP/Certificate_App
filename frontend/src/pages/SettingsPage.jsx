import { useEffect, useState } from 'react';
import { confirmDelete, promptForName } from '../dialogs';
const apiUrl = process.env.REACT_APP_API_URL;

const uniqueOems = (items) => Array.from(
  new Map(items.map((item) => [item.name.trim().toLowerCase(), { ...item, name: item.name.trim() }])).values()
).sort((a, b) => a.name.localeCompare(b.name));

export default function SettingsPage({ theme, setTheme, notify, query = '', realtimeVersion }) {
 
  const [categories, setCategories] = useState([]);
  const [openCategoryActions, setOpenCategoryActions] = useState(null);
  const [oems, setOems] = useState([]);
  const [loadingOems, setLoadingOems] = useState(true);
  const [openOemActions, setOpenOemActions] = useState(null);
  const search = query.trim().toLowerCase();
  const visibleCategories = categories.filter(([name]) => !search || name.toLowerCase().includes(search));
  const visibleOems = oems.filter((oem) => !search || oem.name.toLowerCase().includes(search));
 
  useEffect(() => {
    const loadCategories = async () => {
      try {
        const response = await fetch(`${apiUrl}/access-options/categories`);
        const result = await response.json();
        if (!response.ok) throw new Error(result.detail || 'Unable to load categories');
        setCategories(result.map((item) => [item.name, item.color || '#d84457', item.id]));
      } catch { setCategories([]); }
    };
    const loadOems = async () => {
      try {
        const directoryResponse = await fetch(`${apiUrl}/access-options/oems`);
        const directory = await directoryResponse.json();
        if (!directoryResponse.ok) throw new Error(directory.detail || 'Unable to load OEMs');
        setOems(uniqueOems(directory));
      } catch { setOems([]); }
      finally { setLoadingOems(false); }
    };
    loadCategories();
    loadOems();
  }, []);
 
  useEffect(() => {
    const closeActionMenus = () => {
      setOpenCategoryActions(null);
      setOpenOemActions(null);
    };
    document.addEventListener('click', closeActionMenus);
    return () => document.removeEventListener('click', closeActionMenus);
  }, []);
 
  const addOem = async () => {
    const name = await promptForName({
      title: 'Add OEM',
      label: 'Add an equipment manufacturer to CertTrack.',
      placeholder: 'e.g. Crestron, QSC, Cisco',
      confirmButtonText: 'Add OEM',
    });
    if (!name) return;
    if (oems.some((oem) => oem.name.toLowerCase() === name.toLowerCase())) return notify('That OEM already exists');
    try {
      const response = await fetch(`${apiUrl}/access-options/oems`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.detail || 'Unable to add OEM');
      setOems((items) => uniqueOems([...items, result]));
      notify(`${name} OEM added`);
    } catch (error) { notify(error.message || 'Unable to add OEM'); }
  };
 
  const deleteOem = async (oem) => {
    setOpenOemActions(null);
    if (!(await confirmDelete({ name: `"${oem.name}"`, itemLabel: 'OEM' }))) return;
    try {
      const response = await fetch(`${apiUrl}/access-options/oems/${oem.id}`, { method: 'DELETE' });
      if (!response.ok) throw new Error((await response.json()).detail || 'Unable to delete OEM');
      setOems((items) => items.filter((item) => item.id !== oem.id));
      setOpenOemActions(null);
      notify(`${oem.name} OEM deleted`);
    } catch (error) { notify(error.message || 'Unable to delete OEM'); }
  };
 
  const editOem = async (oem) => {
    setOpenOemActions(null);
    const name = await promptForName({
      title: 'Edit OEM',
      label: 'Update the manufacturer name across the OEM directory.',
      placeholder: 'OEM name',
      initialValue: oem.name,
      confirmButtonText: 'Save changes',
    });
    if (!name || name === oem.name) return;
    if (oems.some((item) => item.id !== oem.id && item.name.toLowerCase() === name.toLowerCase())) {
      notify('That OEM already exists');
      return;
    }
    try {
      const response = await fetch(`${apiUrl}/access-options/oems/${oem.id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.detail || 'Unable to update OEM');
      setOems((items) => uniqueOems(items.map((item) => item.id === oem.id ? result : item)));
      setOpenOemActions(null);
      notify(`${oem.name} updated to ${name}`);
    } catch (error) { notify(error.message || 'Unable to update OEM'); }
  };
 

  const addCategory = async () => {
    const clean = await promptForName({
      title: 'Add category',
      label: 'Create a category for certification records.',
      placeholder: 'e.g. Lighting',
    });
    if (!clean) return;
    if (categories.some(([item]) => item.toLowerCase() === clean.toLowerCase())) {
      notify('That category already exists');
      return;
    }

    try {
      const response = await fetch(`${apiUrl}/access-options/categories`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: clean }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.detail || 'Unable to add category');
      setCategories((items) => [...items, [result.name, result.color || '#d84457', result.id]]);
    } catch (error) { notify(error.message || 'Unable to add category'); return; }
    notify(`Category “${clean}” added`);
  };

  const editCategory = async (name, id) => {
    setOpenCategoryActions(null);
    const clean = await promptForName({
      title: 'Edit category',
      label: 'Update the category name used for certification records.',
      placeholder: 'Category name',
      initialValue: name,
      confirmButtonText: 'Save changes',
    });
    if (!clean || clean === name) return;
    if (categories.some(([item]) => item !== name && item.toLowerCase() === clean.toLowerCase())) {
      notify('That category already exists');
      return;
    }
    try {
      const response = await fetch(`${apiUrl}/access-options/categories/${id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: clean }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.detail || 'Unable to update category');
      setCategories((items) => items.map(([item, color, itemId]) => itemId === id ? [result.name, color, itemId] : [item, color, itemId]));
    } catch (error) { notify(error.message || 'Unable to update category'); return; }
    notify(`Category “${name}” updated to “${clean}”`);
  };

  const deleteCategory = async (name, id) => {
    setOpenCategoryActions(null);
    if (!(await confirmDelete({ name: `“${name}”`, itemLabel: 'category' }))) return;
    try {
      const response = await fetch(`${apiUrl}/access-options/categories/${id}`, { method: 'DELETE' });
      if (!response.ok) throw new Error((await response.json()).detail || 'Unable to delete category');
      setCategories((items) => items.filter(([, , itemId]) => itemId !== id));
    } catch (error) { notify(error.message || 'Unable to delete category'); return; }
    notify(`Category “${name}” deleted`);
  };

  return (
    <div className="settings-exact">
      <p className="settings-lead">
        Manage certification categories and application data.
      </p>

      <section className="er-card settings-card">
        <header>
          <div>
            <h3>Certification categories</h3>
            <p>The buckets shown on the dashboard. Add or reorder as your OEM mix changes.</p>
          </div>
        </header>
        <div className="settings-body categories-body">
          <div className="category-chips">
            {visibleCategories.map(([name, color, id]) => (
              <span key={name}>
                <i style={{ background: color }} />
                <b>{name}</b>
                <button
                  type="button"
                  className="category-action-trigger"
                  onClick={(event) => { event.stopPropagation(); setOpenCategoryActions((current) => current === name ? null : name); }}
                  aria-label={`Show actions for ${name}`}
                  aria-expanded={openCategoryActions === name}
                  title="Actions"
                >
                  <i className="bi bi-three-dots-vertical" />
                </button>
                {openCategoryActions === name && (
                  <span className="category-actions" aria-label={`Actions for ${name}`} onClick={(event) => event.stopPropagation()}>
                    <button type="button" onClick={() => editCategory(name, id)}>
                      <i className="bi bi-pencil" /> Edit
                    </button>
                    <button type="button" className="delete" onClick={() => deleteCategory(name, id)}>
                      <i className="bi bi-trash3" /> Delete
                    </button>
                  </span>
                )}
              </span>
            ))}
          </div>
          <div className="settings-row new-category">
            <div>
              <b>Add a category</b>
              <small>e.g. Lighting, Streaming, Fire &amp; Safety</small>
            </div>
            <button className="outline-action" onClick={addCategory}>
              <i className="bi bi-plus-lg" /> New category
            </button>
          </div>
        </div>
      </section>

      <section className="er-card settings-card oem-settings-card">
        <header>
          <div>
            <h3>OEM directory</h3>
            <p>Manage equipment manufacturers used across certifications and compliance.</p>
          </div>
          <button type="button" className="oem-add-button" onClick={addOem}><i className="bi bi-plus-lg" /> Add OEM</button>
        </header>
        <div className="settings-body oem-settings-body">
          {loadingOems ? <p className="oem-empty">Loading OEM directory...</p> : visibleOems.length ? (
            <div className="oem-settings-grid">
              {visibleOems.map((oem) => (
                <article key={oem.id}>
                  <i className="bi bi-building-gear" />
                  <span><b>{oem.name}</b><small>Certification manufacturer</small></span>
                  <button type="button" className="oem-action-trigger" onClick={(event) => { event.stopPropagation(); setOpenOemActions((current) => current === oem.id ? null : oem.id); }} aria-label={`Actions for ${oem.name}`} aria-expanded={openOemActions === oem.id}><i className="bi bi-three-dots-vertical" /></button>
                  {openOemActions === oem.id && (
                    <div className="oem-action-menu" onClick={(event) => event.stopPropagation()}>
                      <button type="button" onClick={() => editOem(oem)}><i className="bi bi-pencil-square" /><span><b>Edit OEM</b><small>Rename manufacturer</small></span></button>
                      <button type="button" className="delete" onClick={() => deleteOem(oem)}><i className="bi bi-trash3" /><span><b>Delete OEM</b><small>Remove from directory</small></span></button>
                    </div>
                  )}
                </article>
              ))}
            </div>
          ) : (
            <div className="oem-empty"><i className="bi bi-building-gear" /><b>No OEMs added yet</b><small>Add your first manufacturer to build the directory.</small></div>
          )}
        </div>
      </section>
 

    </div>
  );
}
