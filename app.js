/**
 * Swagger Designer — OpenAPI Visual Editor SPA
 * Classes: Store, Parser, UI
 */

'use strict';

/* ===========================
   STORE — localStorage + schema registry
   =========================== */
class Store {
  constructor() {
    this.LS_KEY = 'swagger_designer_v1';
    this.state = this._loadFromLS();
  }

  _defaultState() {
    return {
      theme: 'light',
      spec: null,
    };
  }

  _loadFromLS() {
    try {
      const raw = localStorage.getItem(this.LS_KEY);
      if (raw) return JSON.parse(raw);
    } catch (e) {/* ignore */}
    return this._defaultState();
  }

  save() {
    try {
      localStorage.setItem(this.LS_KEY, JSON.stringify(this.state));
    } catch (e) {/* ignore */}
  }

  getSpec() { return this.state.spec; }

  setSpec(spec) {
    this.state.spec = spec;
    this.save();
  }

  resetSpec(spec) {
    this.state.spec = spec;
    this.save();
  }

  getTheme() { return this.state.theme || 'light'; }
  setTheme(t) { this.state.theme = t; this.save(); }

  /* ---- Schema registry helpers ---- */
  ensureComponents() {
    const spec = this.state.spec;
    if (!spec.components) spec.components = {};
    if (!spec.components.schemas) spec.components.schemas = {};
  }

  getSchema(name) {
    this.ensureComponents();
    return this.state.spec.components.schemas[name] || null;
  }

  setSchema(name, schema) {
    this.ensureComponents();
    this.state.spec.components.schemas[name] = schema;
    this.save();
  }

  getAllSchemas() {
    this.ensureComponents();
    return this.state.spec.components.schemas;
  }

  deleteSchema(name) {
    this.ensureComponents();
    delete this.state.spec.components.schemas[name];
    this.save();
  }

  /* ---- Path helpers ---- */
  getPaths() {
    return (this.state.spec && this.state.spec.paths) ? this.state.spec.paths : {};
  }

  addPath(pathStr) {
    if (!this.state.spec.paths) this.state.spec.paths = {};
    if (!this.state.spec.paths[pathStr]) {
      this.state.spec.paths[pathStr] = {};
    }
    this.save();
  }

  deletePath(pathStr) {
    if (this.state.spec.paths) delete this.state.spec.paths[pathStr];
    this.save();
  }

  addMethod(pathStr, method) {
    if (!this.state.spec.paths[pathStr]) this.state.spec.paths[pathStr] = {};
    const m = method.toLowerCase();
    if (!this.state.spec.paths[pathStr][m]) {
      this.state.spec.paths[pathStr][m] = {
        summary: '',
        description: '',
        parameters: [],
        responses: {
          '200': { description: 'Success', content: { 'application/json': { schema: { '$ref': '' } } } }
        }
      };
    }
    this.save();
  }

  deleteMethod(pathStr, method) {
    if (this.state.spec.paths && this.state.spec.paths[pathStr]) {
      delete this.state.spec.paths[pathStr][method.toLowerCase()];
      this.save();
    }
  }

  getOperation(pathStr, method) {
    const paths = this.getPaths();
    return (paths[pathStr] && paths[pathStr][method.toLowerCase()]) || null;
  }

  saveOperation(pathStr, method, op) {
    if (!this.state.spec.paths[pathStr]) this.state.spec.paths[pathStr] = {};
    this.state.spec.paths[pathStr][method.toLowerCase()] = op;
    this.save();
  }

  addResponse(pathStr, method, statusCode) {
    const op = this.getOperation(pathStr, method);
    if (!op) return;
    if (!op.responses) op.responses = {};
    if (!op.responses[statusCode]) {
      op.responses[statusCode] = {
        description: statusCode === '200' ? 'Success' : statusCode === '400' ? 'Bad Request' : 'Response',
        content: { 'application/json': { schema: { '$ref': '' } } }
      };
    }
    this.saveOperation(pathStr, method, op);
  }

  deleteResponse(pathStr, method, statusCode) {
    const op = this.getOperation(pathStr, method);
    if (!op || !op.responses) return;
    delete op.responses[statusCode];
    this.saveOperation(pathStr, method, op);
  }
}

/* ===========================
   PARSER — flat path <-> OpenAPI JSON Schema
   =========================== */
class Parser {
  /**
   * Convert flat rows [{path, type, description, example}]
   * into an OpenAPI JSON Schema object.
   * Supports dot notation and [] for arrays.
   * Example: 'users[].address.city' → nested schema
   */
  static flatToSchema(rows) {
    const root = { type: 'object', properties: {} };

    for (const row of rows) {
      if (!row.path || !row.path.trim()) continue;
      Parser._setPath(root, row.path.trim(), {
        type: row.type || 'string',
        description: row.description || undefined,
        example: row.example !== '' && row.example !== undefined ? row.example : undefined,
      });
    }
    return root;
  }

  /**
   * Parse a flat dot/bracket path and set value in schema.
   * e.g. 'users[].address.city'
   */
  static _setPath(schema, flatPath, fieldDef) {
    const segments = Parser._parsePath(flatPath);
    if (!segments.length) return;

    let current = schema;
    for (let i = 0; i < segments.length - 1; i++) {
      const seg = segments[i];
      const isArray = seg.isArray;
      const key = seg.key;

      if (!current.properties) current.properties = {};
      if (!current.properties[key]) {
        if (isArray) {
          current.properties[key] = { type: 'array', items: { type: 'object', properties: {} } };
        } else {
          current.properties[key] = { type: 'object', properties: {} };
        }
      }
      if (isArray) {
        if (!current.properties[key].items) current.properties[key].items = { type: 'object', properties: {} };
        current = current.properties[key].items;
      } else {
        current = current.properties[key];
      }
      if (!current.properties) current.properties = {};
    }

    // last segment
    const last = segments[segments.length - 1];
    if (!current.properties) current.properties = {};

    const node = {};
    if (fieldDef.type === 'array') {
      node.type = 'array';
      node.items = { type: 'string' };
    } else if (fieldDef.type === 'object') {
      node.type = 'object';
      node.properties = {};
    } else {
      node.type = fieldDef.type || 'string';
    }
    if (fieldDef.description) node.description = fieldDef.description;
    if (fieldDef.example !== undefined) {
      const val = Parser._castExample(fieldDef.example, node.type);
      if (val !== undefined) node.example = val;
    }

    if (last.isArray) {
      current.properties[last.key] = { type: 'array', items: node };
    } else {
      current.properties[last.key] = node;
    }
  }

  static _parsePath(path) {
    // Split by dots, keeping [] markers
    const segments = [];
    const parts = path.split('.');
    for (const part of parts) {
      if (!part) continue;
      const idx = part.indexOf('[]');
      if (idx !== -1) {
        segments.push({ key: part.replace('[]', ''), isArray: true });
      } else {
        segments.push({ key: part, isArray: false });
      }
    }
    return segments;
  }

  static _castExample(val, type) {
    if (val === '' || val === undefined) return undefined;
    try {
      if (type === 'integer' || type === 'number') return Number(val);
      if (type === 'boolean') return val === 'true' || val === true;
      return String(val);
    } catch (_) { return String(val); }
  }

  /**
   * Convert an OpenAPI schema back to flat rows.
   */
  static schemaToFlat(schema, prefix = '') {
    const rows = [];
    if (!schema || !schema.properties) return rows;

    for (const [key, def] of Object.entries(schema.properties)) {
      const fullPath = prefix ? `${prefix}.${key}` : key;

      if (def.type === 'array' && def.items) {
        const arrPath = `${fullPath}[]`;
        if (def.items.type === 'object' && def.items.properties) {
          rows.push(...Parser.schemaToFlat(def.items, arrPath));
        } else {
          rows.push({
            path: arrPath,
            type: def.items.type || 'string',
            description: def.description || '',
            example: def.example !== undefined ? String(def.example) : '',
          });
        }
      } else if (def.type === 'object' && def.properties) {
        rows.push(...Parser.schemaToFlat(def, fullPath));
      } else {
        rows.push({
          path: fullPath,
          type: def.type || 'string',
          description: def.description || '',
          example: def.example !== undefined ? String(def.example) : '',
        });
      }
    }
    return rows;
  }

  /**
   * Build full exportable OpenAPI spec from Store.
   * Replaces inline schemas with $ref to components.schemas.
   */
  static buildExportSpec(store) {
    const spec = JSON.parse(JSON.stringify(store.getSpec()));
    // components.schemas already hold the canonical schemas;
    // ensure all $ref links are correctly placed
    if (spec.paths) {
      for (const [, pathItem] of Object.entries(spec.paths)) {
        for (const [, op] of Object.entries(pathItem)) {
          if (typeof op !== 'object' || !op) continue;
          // requestBody
          if (op.requestBody) {
            const content = op.requestBody.content && op.requestBody.content['application/json'];
            if (content && content._schemaName) {
              content.schema = { '$ref': `#/components/schemas/${content._schemaName}` };
              delete content._schemaName;
            }
          }
          // responses
          if (op.responses) {
            for (const [, resp] of Object.entries(op.responses)) {
              const rc = resp.content && resp.content['application/json'];
              if (rc && rc._schemaName) {
                rc.schema = { '$ref': `#/components/schemas/${rc._schemaName}` };
                delete rc._schemaName;
              }
            }
          }
        }
      }
    }
    // clean empty $ref
    if (spec.components && spec.components.schemas) {
      for (const [k, s] of Object.entries(spec.components.schemas)) {
        if (!s || Object.keys(s).length === 0) delete spec.components.schemas[k];
      }
      if (Object.keys(spec.components.schemas).length === 0) {
        delete spec.components.schemas;
        if (Object.keys(spec.components).length === 0) delete spec.components;
      }
    }
    return spec;
  }

  /**
   * Generate auto object name from path+method+context
   */
  static generateObjectName(pathStr, method, context) {
    const parts = (pathStr || '/').split('/').filter(p => p && !p.startsWith('{'));
    const resource = parts.map(p => p.charAt(0).toUpperCase() + p.slice(1)).join('');
    const m = (method || 'get').charAt(0).toUpperCase() + (method || 'get').slice(1).toLowerCase();
    if (context === 'requestBody') {
      return `${m}${resource || 'Api'}Request`;
    } else {
      return `${m}${resource || 'Api'}Response${context || ''}`;
    }
  }
}

/* ===========================
   UI — render, events
   =========================== */
class UI {
  constructor(store) {
    this.store = store;
    this.activeNode = null; // {type, pathStr, method, section, statusCode}
    this._init();
  }

  _init() {
    // Theme
    const theme = this.store.getTheme();
    document.documentElement.setAttribute('data-theme', theme);
    this._updateThemeIcon(theme);

    // Buttons
    document.getElementById('btn-new').addEventListener('click', () => this._newAPI());
    document.getElementById('btn-new-empty').addEventListener('click', () => this._newAPI());
    document.getElementById('btn-import').addEventListener('click', () => document.getElementById('file-input').click());
    document.getElementById('btn-export-json').addEventListener('click', () => this._export('json'));
    document.getElementById('btn-export-yaml').addEventListener('click', () => this._export('yaml'));
    document.getElementById('theme-toggle').addEventListener('click', () => this._toggleTheme());
    document.getElementById('error-modal-close').addEventListener('click', () => this._hideErrorModal());
    document.getElementById('file-input').addEventListener('change', e => this._handleImport(e));

    if (this.store.getSpec()) {
      this.renderSidebar();
    }
  }

  /* ---- Theme ---- */
  _toggleTheme() {
    const current = this.store.getTheme();
    const next = current === 'light' ? 'dark' : 'light';
    this.store.setTheme(next);
    document.documentElement.setAttribute('data-theme', next);
    this._updateThemeIcon(next);
  }

  _updateThemeIcon(theme) {
    const icon = document.getElementById('theme-icon');
    if (icon) icon.textContent = theme === 'dark' ? 'light_mode' : 'dark_mode';
  }

  /* ---- New API ---- */
  _newAPI() {
    if (this.store.getSpec()) {
      if (!confirm('Creating a new API will erase the current specification. Continue?')) return;
    }
    const spec = {
      openapi: '3.1.0',
      info: { title: 'New API', version: '1.0.0', description: '' },
      servers: [{ url: 'https://api.example.com' }],
      paths: {},
      components: { schemas: {} },
    };
    this.store.resetSpec(spec);
    this.activeNode = null;
    this.renderSidebar();
    this._activateNode({ type: 'root' });
    this._showToast('New API created', 'success');
  }

  /* ---- Import ---- */
  _handleImport(e) {
    const file = e.target.files[0];
    if (!file) return;
    e.target.value = '';

    if (this.store.getSpec()) {
      if (!confirm('Importing will replace the current specification. Continue?')) return;
    }

    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target.result;
      try {
        let spec;
        if (file.name.endsWith('.json')) {
          spec = JSON.parse(text);
        } else {
          spec = jsyaml.load(text);
        }
        if (!spec || typeof spec !== 'object') throw new Error('Parsed result is not an object');
        if (!spec.openapi) spec.openapi = '3.1.0';
        if (!spec.info) spec.info = { title: 'Imported API', version: '1.0.0' };
        if (!spec.paths) spec.paths = {};
        if (!spec.components) spec.components = {};
        if (!spec.components.schemas) spec.components.schemas = {};

        // Normalize inline schemas to registry
        this._normalizeImportedSpec(spec);

        this.store.resetSpec(spec);
        this.activeNode = null;
        this.renderSidebar();
        this._activateNode({ type: 'root' });
        this._showToast('Specification imported successfully', 'success');
      } catch (err) {
        this._showErrorModal(err.message || String(err));
      }
    };
    reader.readAsText(file);
  }

  _normalizeImportedSpec(spec) {
    // Walk paths and extract inline schemas into components
    if (!spec.paths) return;
    for (const [pathStr, pathItem] of Object.entries(spec.paths)) {
      for (const [method, op] of Object.entries(pathItem)) {
        if (typeof op !== 'object' || !op) continue;
        // requestBody
        if (op.requestBody) {
          const c = op.requestBody.content && op.requestBody.content['application/json'];
          if (c) {
            if (c.schema && c.schema['$ref']) {
              const name = c.schema['$ref'].replace('#/components/schemas/', '');
              c._schemaName = name;
            } else if (c.schema && !c.schema['$ref']) {
              const name = Parser.generateObjectName(pathStr, method, 'requestBody');
              spec.components.schemas[name] = c.schema;
              c._schemaName = name;
              c.schema = { '$ref': `#/components/schemas/${name}` };
            }
          }
        }
        // responses
        if (op.responses) {
          for (const [code, resp] of Object.entries(op.responses)) {
            const rc = resp.content && resp.content['application/json'];
            if (rc) {
              if (rc.schema && rc.schema['$ref']) {
                const name = rc.schema['$ref'].replace('#/components/schemas/', '');
                rc._schemaName = name;
              } else if (rc.schema && !rc.schema['$ref']) {
                const name = Parser.generateObjectName(pathStr, method, code);
                spec.components.schemas[name] = rc.schema;
                rc._schemaName = name;
                rc.schema = { '$ref': `#/components/schemas/${name}` };
              }
            }
          }
        }
      }
    }
  }

  /* ---- Export ---- */
  _export(format) {
    const spec = this.store.getSpec();
    if (!spec) { this._showToast('No specification to export', 'error'); return; }
    const exportSpec = Parser.buildExportSpec(this.store);
    let content, filename, mime;
    if (format === 'json') {
      content = JSON.stringify(exportSpec, null, 2);
      filename = 'openapi.json';
      mime = 'application/json';
    } else {
      content = jsyaml.dump(exportSpec, { lineWidth: 120, noRefs: true });
      filename = 'openapi.yaml';
      mime = 'text/yaml';
    }
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename; a.click();
    URL.revokeObjectURL(url);
    this._showToast(`Exported as ${filename}`, 'success');
  }

  /* ---- Sidebar render ---- */
  renderSidebar() {
    const spec = this.store.getSpec();
    const root = document.getElementById('tree-root');
    root.innerHTML = '';
    if (!spec) return;

    // Root node
    const rootEl = this._makeTreeItem({
      label: spec.info && spec.info.title ? spec.info.title : 'Untitled API',
      icon: 'hub',
      level: 0,
      node: { type: 'root' },
      actions: [],
    });
    root.appendChild(rootEl);

    // Paths
    const paths = this.store.getPaths();
    for (const [pathStr, pathItem] of Object.entries(paths)) {
      // Path group row
      const pathEl = this._makeTreeItem({
        label: pathStr,
        icon: 'route',
        level: 1,
        node: null,
        actions: [
          { icon: 'add', title: 'Add method', action: () => this._promptAddMethod(pathStr) },
          { icon: 'delete', title: 'Delete path', danger: true, action: () => this._deletePath(pathStr) },
        ],
      });
      root.appendChild(pathEl);

      // Methods
      const httpMethods = ['get','post','put','patch','delete','head','options'];
      for (const method of httpMethods) {
        if (!pathItem[method]) continue;
        const op = pathItem[method];
        const methodEl = this._makeMethodTreeItem(pathStr, method, op);
        root.appendChild(methodEl);

        // Parameters
        const paramEl = this._makeTreeItem({
          label: 'Parameters',
          icon: 'tune',
          level: 3,
          node: { type: 'parameters', pathStr, method },
          actions: [],
        });
        root.appendChild(paramEl);

        // Request Body
        const rbEl = this._makeTreeItem({
          label: 'Request Body',
          icon: 'input',
          level: 3,
          node: { type: 'requestBody', pathStr, method },
          actions: [],
        });
        root.appendChild(rbEl);

        // Responses
        if (op.responses) {
          for (const code of Object.keys(op.responses)) {
            const respEl = this._makeTreeItem({
              label: `Response ${code}`,
              icon: 'output',
              level: 3,
              node: { type: 'response', pathStr, method, statusCode: code },
              actions: [
                { icon: 'delete', title: 'Delete response', danger: true,
                  action: () => { this.store.deleteResponse(pathStr, method, code); this.renderSidebar(); } }
              ],
            });
            root.appendChild(respEl);
          }
          // Add response button
          const addRespRow = document.createElement('div');
          addRespRow.className = 'tree-add-row';
          addRespRow.style.paddingLeft = '64px';
          const addRespBtn = document.createElement('button');
          addRespBtn.className = 'tree-add-btn';
          addRespBtn.innerHTML = '<i class="material-icons">add</i> Response';
          addRespBtn.addEventListener('click', (e) => { e.stopPropagation(); this._promptAddResponse(pathStr, method); });
          addRespRow.appendChild(addRespBtn);
          root.appendChild(addRespRow);
        }

        // Delete method button at method level
        const delMethodRow = document.createElement('div');
        delMethodRow.className = 'tree-add-row';
        delMethodRow.style.paddingLeft = '48px';
        const delMethodBtn = document.createElement('button');
        delMethodBtn.className = 'tree-add-btn';
        delMethodBtn.style.color = 'var(--color-error)';
        delMethodBtn.innerHTML = '<i class="material-icons" style="font-size:14px">delete</i> Delete method';
        delMethodBtn.addEventListener('click', (e) => { e.stopPropagation(); this._deleteMethod(pathStr, method); });
        delMethodRow.appendChild(delMethodBtn);
        root.appendChild(delMethodRow);
      }
    }

    // Add path button
    const addPathRow = document.createElement('div');
    addPathRow.className = 'tree-add-row';
    const addPathBtn = document.createElement('button');
    addPathBtn.className = 'tree-add-btn';
    addPathBtn.innerHTML = '<i class="material-icons">add</i> Add Path';
    addPathBtn.addEventListener('click', () => this._promptAddPath());
    addPathRow.appendChild(addPathBtn);
    root.appendChild(addPathRow);

    // Restore active highlight
    if (this.activeNode) this._highlightActive();
  }

  _makeTreeItem({ label, icon, level, node, actions }) {
    const el = document.createElement('div');
    el.className = `tree-item tree-level-${level}`;
    if (node) el.dataset.nodeKey = JSON.stringify(node);

    const iconEl = document.createElement('i');
    iconEl.className = 'material-icons';
    iconEl.textContent = icon;
    el.appendChild(iconEl);

    const labelEl = document.createElement('span');
    labelEl.className = 'tree-item-label';
    labelEl.textContent = label;
    el.appendChild(labelEl);

    if (actions && actions.length) {
      const actionsEl = document.createElement('div');
      actionsEl.className = 'tree-item-actions';
      for (const act of actions) {
        const btn = document.createElement('button');
        btn.className = 'tree-action-btn' + (act.danger ? ' danger' : '');
        btn.title = act.title || '';
        btn.innerHTML = `<i class="material-icons">${act.icon}</i>`;
        btn.addEventListener('click', (e) => { e.stopPropagation(); act.action(); });
        actionsEl.appendChild(btn);
      }
      el.appendChild(actionsEl);
    }

    if (node) {
      el.addEventListener('click', () => this._activateNode(node));
    }
    return el;
  }

  _makeMethodTreeItem(pathStr, method, op) {
    const el = document.createElement('div');
    el.className = 'tree-item tree-level-2';
    el.dataset.nodeKey = JSON.stringify({ type: 'operation', pathStr, method });

    const badge = document.createElement('span');
    badge.className = `method-badge method-${method.toUpperCase()}`;
    badge.textContent = method.toUpperCase();
    el.appendChild(badge);

    const labelEl = document.createElement('span');
    labelEl.className = 'tree-item-label';
    labelEl.style.paddingLeft = '4px';
    labelEl.textContent = op.summary || pathStr;
    el.appendChild(labelEl);

    el.addEventListener('click', () => this._activateNode({ type: 'operation', pathStr, method }));
    return el;
  }

  _activateNode(node) {
    this.activeNode = node;
    this._highlightActive();
    this._renderContent(node);
  }

  _highlightActive() {
    document.querySelectorAll('.tree-item.active').forEach(el => el.classList.remove('active'));
    if (!this.activeNode) return;
    const key = JSON.stringify(this.activeNode);
    document.querySelectorAll('.tree-item[data-node-key]').forEach(el => {
      if (el.dataset.nodeKey === key) el.classList.add('active');
    });
  }

  /* ---- Content rendering ---- */
  _renderContent(node) {
    const panel = document.getElementById('content-panel');
    if (node.type === 'root') {
      panel.innerHTML = '';
      panel.appendChild(this._buildRootForm());
    } else if (node.type === 'parameters') {
      panel.innerHTML = '';
      panel.appendChild(this._buildParametersPanel(node.pathStr, node.method));
    } else if (node.type === 'requestBody') {
      panel.innerHTML = '';
      panel.appendChild(this._buildBodyPanel(node.pathStr, node.method, 'requestBody', null));
    } else if (node.type === 'response') {
      panel.innerHTML = '';
      panel.appendChild(this._buildBodyPanel(node.pathStr, node.method, 'response', node.statusCode));
    } else if (node.type === 'operation') {
      panel.innerHTML = '';
      panel.appendChild(this._buildOperationForm(node.pathStr, node.method));
    }
  }

  /* ---- Root / Info form ---- */
  _buildRootForm() {
    const spec = this.store.getSpec();
    const info = spec.info || {};
    const servers = spec.servers || [];

    const wrap = document.createElement('div');
    const title = document.createElement('div');
    title.className = 'panel-title';
    title.innerHTML = '<i class="material-icons">info</i> API Info';
    wrap.appendChild(title);

    const sec = document.createElement('div');
    sec.className = 'form-section';
    sec.innerHTML = `
      <h5>General</h5>
      <div class="form-grid">
        <div class="form-field">
          <label class="form-label">Title</label>
          <input class="form-input" id="info-title" value="${this._esc(info.title || '')}" placeholder="My API" />
        </div>
        <div class="form-field">
          <label class="form-label">Version</label>
          <input class="form-input" id="info-version" value="${this._esc(info.version || '')}" placeholder="1.0.0" />
        </div>
        <div class="form-field full">
          <label class="form-label">Description</label>
          <textarea class="form-input" id="info-desc" rows="3" placeholder="Describe your API...">${this._esc(info.description || '')}</textarea>
        </div>
      </div>
    `;
    wrap.appendChild(sec);

    // Servers
    const secSrv = document.createElement('div');
    secSrv.className = 'form-section';
    secSrv.innerHTML = '<h5>Servers</h5>';
    const serversList = document.createElement('div');
    serversList.className = 'servers-list';
    serversList.id = 'servers-list';

    const renderServers = () => {
      serversList.innerHTML = '';
      const srvs = this.store.getSpec().servers || [];
      srvs.forEach((srv, i) => {
        const row = document.createElement('div');
        row.className = 'server-item';
        row.innerHTML = `
          <input class="form-input" placeholder="https://api.example.com" value="${this._esc(srv.url || '')}" data-idx="${i}" />
          <button class="btn-icon danger" data-del="${i}" title="Remove server"><i class="material-icons">delete</i></button>
        `;
        row.querySelector('input').addEventListener('input', ev => {
          this.store.getSpec().servers[i].url = ev.target.value;
          this.store.save();
        });
        row.querySelector('button').addEventListener('click', () => {
          this.store.getSpec().servers.splice(i, 1);
          this.store.save();
          renderServers();
        });
        serversList.appendChild(row);
      });
    };
    renderServers();
    secSrv.appendChild(serversList);

    const addSrvBtn = document.createElement('button');
    addSrvBtn.className = 'btn btn-ghost btn-sm';
    addSrvBtn.style.marginTop = 'var(--space-2)';
    addSrvBtn.innerHTML = '<i class="material-icons">add</i> Add Server';
    addSrvBtn.addEventListener('click', () => {
      if (!this.store.getSpec().servers) this.store.getSpec().servers = [];
      this.store.getSpec().servers.push({ url: '' });
      this.store.save();
      renderServers();
    });
    secSrv.appendChild(addSrvBtn);
    wrap.appendChild(secSrv);

    // Auto-save info fields
    const autoSaveInfo = () => {
      const s = this.store.getSpec();
      s.info.title = document.getElementById('info-title').value;
      s.info.version = document.getElementById('info-version').value;
      s.info.description = document.getElementById('info-desc').value;
      this.store.save();
      // update sidebar root label
      const rootLabel = document.querySelector('.tree-item.tree-level-0 .tree-item-label');
      if (rootLabel) rootLabel.textContent = s.info.title || 'Untitled API';
    };
    setTimeout(() => {
      ['info-title','info-version','info-desc'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('input', autoSaveInfo);
      });
    }, 0);

    return wrap;
  }

  /* ---- Operation form ---- */
  _buildOperationForm(pathStr, method) {
    const op = this.store.getOperation(pathStr, method);
    const wrap = document.createElement('div');
    const titleEl = document.createElement('div');
    titleEl.className = 'panel-title';
    titleEl.innerHTML = `<span class="method-badge method-${method.toUpperCase()}">${method.toUpperCase()}</span> <span style="font-family:var(--font-mono);font-size:.95em">${this._esc(pathStr)}</span>`;
    wrap.appendChild(titleEl);

    const sec = document.createElement('div');
    sec.className = 'form-section';
    sec.innerHTML = `
      <h5>Operation</h5>
      <div class="form-grid">
        <div class="form-field full">
          <label class="form-label">Summary</label>
          <input class="form-input" id="op-summary" value="${this._esc(op.summary || '')}" placeholder="Short summary" />
        </div>
        <div class="form-field full">
          <label class="form-label">Description</label>
          <textarea class="form-input" id="op-desc" rows="3" placeholder="Operation description...">${this._esc(op.description || '')}</textarea>
        </div>
        <div class="form-field">
          <label class="form-label">Operation ID</label>
          <input class="form-input" id="op-id" value="${this._esc(op.operationId || '')}" placeholder="listUsers" />
        </div>
      </div>
    `;
    wrap.appendChild(sec);

    const autoSave = () => {
      const o = this.store.getOperation(pathStr, method);
      o.summary = document.getElementById('op-summary').value;
      o.description = document.getElementById('op-desc').value;
      o.operationId = document.getElementById('op-id').value;
      this.store.saveOperation(pathStr, method, o);
      // update sidebar label
      const key = JSON.stringify({ type: 'operation', pathStr, method });
      const el = document.querySelector(`.tree-item[data-node-key='${key}'] .tree-item-label`);
      if (el) el.textContent = o.summary || pathStr;
    };
    setTimeout(() => {
      ['op-summary','op-desc','op-id'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('input', autoSave);
      });
    }, 0);
    return wrap;
  }

  /* ---- Parameters panel ---- */
  _buildParametersPanel(pathStr, method) {
    const op = this.store.getOperation(pathStr, method);
    const params = op ? (op.parameters || []) : [];

    const wrap = document.createElement('div');
    const titleEl = document.createElement('div');
    titleEl.className = 'panel-title';
    titleEl.innerHTML = '<i class="material-icons">tune</i> Parameters';
    wrap.appendChild(titleEl);

    const toolbar = document.createElement('div');
    toolbar.className = 'table-toolbar';
    const addBtn = document.createElement('button');
    addBtn.className = 'btn btn-primary btn-sm';
    addBtn.innerHTML = '<i class="material-icons">add</i> Add Parameter';
    toolbar.appendChild(addBtn);
    wrap.appendChild(toolbar);

    const tableWrap = document.createElement('div');
    tableWrap.className = 'data-table-wrap';
    const table = document.createElement('table');
    table.className = 'data-table';
    table.innerHTML = `<thead><tr>
      <th>In</th><th>Name</th><th>Description</th><th>Example</th><th width="40"></th>
    </tr></thead>`;
    const tbody = document.createElement('tbody');
    table.appendChild(tbody);
    tableWrap.appendChild(table);
    wrap.appendChild(tableWrap);

    const renderRows = () => {
      tbody.innerHTML = '';
      const op2 = this.store.getOperation(pathStr, method);
      const ps = op2 ? (op2.parameters || []) : [];
      if (!ps.length) {
        const tr = document.createElement('tr');
        tr.innerHTML = `<td colspan="5" style="text-align:center;color:var(--color-text-faint);padding:var(--space-4)">No parameters. Click "Add Parameter" to start.</td>`;
        tbody.appendChild(tr);
        return;
      }
      ps.forEach((p, i) => {
        const tr = document.createElement('tr');
        const inSel = `<select class="td-select">
          ${['query','header','path','cookie'].map(v => `<option ${p.in===v?'selected':''} value="${v}">${v}</option>`).join('')}
        </select>`;
        tr.innerHTML = `
          <td>${inSel}</td>
          <td><input class="td-input" value="${this._esc(p.name||'')}" placeholder="paramName" /></td>
          <td><input class="td-input" value="${this._esc(p.description||'')}" placeholder="Description" /></td>
          <td><input class="td-input" value="${this._esc(this._getParamExample(p))}" placeholder="example" /></td>
          <td><button class="btn-icon danger" title="Delete"><i class="material-icons" style="font-size:16px">delete</i></button></td>
        `;
        // Bind events
        const [selIn, inpName, inpDesc, inpEx] = tr.querySelectorAll('select, input');
        const save = () => {
          const o = this.store.getOperation(pathStr, method);
          if (!o.parameters) o.parameters = [];
          if (!o.parameters[i]) o.parameters[i] = {};
          o.parameters[i].in = selIn.value;
          o.parameters[i].name = inpName.value;
          o.parameters[i].description = inpDesc.value;
          if (!o.parameters[i].schema) o.parameters[i].schema = {};
          o.parameters[i].schema.example = inpEx.value;
          this.store.saveOperation(pathStr, method, o);
        };
        [selIn, inpName, inpDesc, inpEx].forEach(el => el.addEventListener('input', save));
        tr.querySelector('.btn-icon.danger').addEventListener('click', () => {
          const o = this.store.getOperation(pathStr, method);
          o.parameters.splice(i, 1);
          this.store.saveOperation(pathStr, method, o);
          renderRows();
        });
        tbody.appendChild(tr);
      });
    };

    addBtn.addEventListener('click', () => {
      const o = this.store.getOperation(pathStr, method);
      if (!o.parameters) o.parameters = [];
      o.parameters.push({ in: 'query', name: '', description: '', schema: {} });
      this.store.saveOperation(pathStr, method, o);
      renderRows();
    });

    renderRows();
    return wrap;
  }

  _getParamExample(p) {
    return (p.schema && p.schema.example !== undefined) ? String(p.schema.example) : '';
  }

  /* ---- Body / Response panel ---- */
  _buildBodyPanel(pathStr, method, context, statusCode) {
    const op = this.store.getOperation(pathStr, method);

    // Determine current schema name
    let currentSchemaName = '';
    if (context === 'requestBody') {
      const c = op && op.requestBody && op.requestBody.content && op.requestBody.content['application/json'];
      currentSchemaName = (c && c._schemaName) || Parser.generateObjectName(pathStr, method, 'requestBody');
    } else {
      const resp = op && op.responses && op.responses[statusCode];
      const c = resp && resp.content && resp.content['application/json'];
      currentSchemaName = (c && c._schemaName) || Parser.generateObjectName(pathStr, method, statusCode);
    }

    const wrap = document.createElement('div');
    const titleEl = document.createElement('div');
    titleEl.className = 'panel-title';
    if (context === 'requestBody') {
      titleEl.innerHTML = '<i class="material-icons">input</i> Request Body';
    } else {
      const cls = statusCode && statusCode.startsWith('2') ? 'status-2xx' : statusCode && statusCode.startsWith('4') ? 'status-4xx' : 'status-5xx';
      titleEl.innerHTML = `<i class="material-icons">output</i> Response <span class="status-badge ${cls}">${statusCode}</span>`;
    }
    wrap.appendChild(titleEl);

    // Response description row (for responses only)
    if (context === 'response') {
      const descSec = document.createElement('div');
      descSec.className = 'form-section';
      const resp = op && op.responses && op.responses[statusCode];
      descSec.innerHTML = `
        <h5>Status</h5>
        <div class="status-row">
          <div>
            <div class="form-label" style="margin-bottom:4px">Status Code</div>
            <input class="status-input" id="resp-code" value="${this._esc(statusCode)}" />
          </div>
          <div style="flex:1">
            <div class="form-label" style="margin-bottom:4px">Description</div>
            <input class="status-desc-input" id="resp-desc" value="${this._esc((resp && resp.description) || '')}" placeholder="Response description" />
          </div>
        </div>
      `;
      wrap.appendChild(descSec);
      setTimeout(() => {
        const codeInput = document.getElementById('resp-code');
        const descInput = document.getElementById('resp-desc');
        if (codeInput) codeInput.addEventListener('blur', () => {
          const newCode = codeInput.value.trim();
          if (!newCode || newCode === statusCode) return;
          const o = this.store.getOperation(pathStr, method);
          const old = o.responses[statusCode];
          delete o.responses[statusCode];
          o.responses[newCode] = old;
          this.store.saveOperation(pathStr, method, o);
          // re-render sidebar & content
          this.activeNode = { type: 'response', pathStr, method, statusCode: newCode };
          this.renderSidebar();
          this._renderContent(this.activeNode);
        });
        if (descInput) descInput.addEventListener('input', () => {
          const o = this.store.getOperation(pathStr, method);
          if (o.responses[statusCode]) o.responses[statusCode].description = descInput.value;
          this.store.saveOperation(pathStr, method, o);
        });
      }, 0);
    }

    // Object name section
    const toolbar = document.createElement('div');
    toolbar.className = 'table-toolbar';

    const nameField = document.createElement('div');
    nameField.className = 'object-name-field';
    const nameLabel = document.createElement('label');
    nameLabel.textContent = 'Object Name:';
    const nameInput = document.createElement('input');
    nameInput.value = currentSchemaName;
    nameInput.placeholder = 'SchemaName';
    nameField.appendChild(nameLabel);
    nameField.appendChild(nameInput);
    toolbar.appendChild(nameField);

    // Shared badge
    const sharedBadge = document.createElement('span');
    sharedBadge.className = 'shared-badge';
    sharedBadge.style.display = 'none';
    sharedBadge.textContent = 'shared';
    toolbar.appendChild(sharedBadge);
    this._updateSharedBadge(sharedBadge, currentSchemaName);

    const addFieldBtn = document.createElement('button');
    addFieldBtn.className = 'btn btn-primary btn-sm';
    addFieldBtn.innerHTML = '<i class="material-icons">add</i> Add Field';
    addFieldBtn.style.marginLeft = 'auto';
    toolbar.appendChild(addFieldBtn);
    wrap.appendChild(toolbar);

    // Table
    const tableWrap = document.createElement('div');
    tableWrap.className = 'data-table-wrap';
    const table = document.createElement('table');
    table.className = 'data-table';
    table.innerHTML = `<thead><tr>
      <th>Path</th><th>Type</th><th>Description</th><th>Example</th><th width="40"></th>
    </tr></thead>`;
    const tbody = document.createElement('tbody');
    table.appendChild(tbody);
    tableWrap.appendChild(table);
    wrap.appendChild(tableWrap);

    // Get rows from schema
    const getRows = (schemaName) => {
      const schema = this.store.getSchema(schemaName);
      return schema ? Parser.schemaToFlat(schema) : [];
    };

    const renderRows = (schemaName, overrideRows) => {
      tbody.innerHTML = '';
      const rows = overrideRows !== undefined ? overrideRows : getRows(schemaName);
      if (!rows.length) {
        const tr = document.createElement('tr');
        tr.innerHTML = `<td colspan="5" style="text-align:center;color:var(--color-text-faint);padding:var(--space-4)">No fields. Click "Add Field" to define the schema.</td>`;
        tbody.appendChild(tr);
        return;
      }
      rows.forEach((row, i) => {
        const tr = document.createElement('tr');
        const typeSel = `<select class="td-select">
          ${['string','integer','number','boolean','array','object'].map(v => `<option ${row.type===v?'selected':''} value="${v}">${v}</option>`).join('')}
        </select>`;
        tr.innerHTML = `
          <td><input class="td-input td-path" value="${this._esc(row.path)}" placeholder="field.name" /></td>
          <td>${typeSel}</td>
          <td><input class="td-input" value="${this._esc(row.description)}" placeholder="Description" /></td>
          <td><input class="td-input" value="${this._esc(row.example)}" placeholder="example" /></td>
          <td><button class="btn-icon danger" title="Delete"><i class="material-icons" style="font-size:16px">delete</i></button></td>
        `;
        const [inpPath, selType, inpDesc, inpEx] = [tr.querySelector('.td-path'), tr.querySelector('select'), ...tr.querySelectorAll('input:not(.td-path)')];
        const saveRows = () => {
          rows[i] = {
            path: inpPath.value,
            type: selType.value,
            description: inpDesc.value,
            example: inpEx.value,
          };
          const newSchema = Parser.flatToSchema(rows);
          this.store.setSchema(nameInput.value, newSchema);
          this._linkSchema(pathStr, method, context, statusCode, nameInput.value);
        };
        [inpPath, selType, inpDesc, inpEx].forEach(el => el.addEventListener('input', saveRows));
        tr.querySelector('.btn-icon.danger').addEventListener('click', () => {
          rows.splice(i, 1);
          const newSchema = Parser.flatToSchema(rows);
          this.store.setSchema(nameInput.value, newSchema);
          this._linkSchema(pathStr, method, context, statusCode, nameInput.value);
          renderRows(nameInput.value);
        });
        tbody.appendChild(tr);
      });
    };

    // Name input change: switch schema
    nameInput.addEventListener('change', () => {
      const newName = nameInput.value.trim();
      if (!newName) return;
      // If schema exists, load it; else create empty
      if (!this.store.getSchema(newName)) {
        this.store.setSchema(newName, { type: 'object', properties: {} });
      }
      this._linkSchema(pathStr, method, context, statusCode, newName);
      this._updateSharedBadge(sharedBadge, newName);
      renderRows(newName);
    });

    addFieldBtn.addEventListener('click', () => {
      const sName = nameInput.value.trim() || currentSchemaName;
      if (!this.store.getSchema(sName)) {
        this.store.setSchema(sName, { type: 'object', properties: {} });
        this._linkSchema(pathStr, method, context, statusCode, sName);
      }
      const curRows = getRows(sName);
      curRows.push({ path: '', type: 'string', description: '', example: '' });
      // Pass rows directly so the new empty row renders immediately.
      // flatToSchema skips empty-path rows, so we cannot save to schema yet —
      // saving happens via saveRows once the user types a field name.
      renderRows(sName, curRows);
    });

    // Init: ensure schema exists
    if (!this.store.getSchema(currentSchemaName)) {
      this.store.setSchema(currentSchemaName, { type: 'object', properties: {} });
    }
    this._linkSchema(pathStr, method, context, statusCode, currentSchemaName);
    renderRows(currentSchemaName);

    return wrap;
  }

  _updateSharedBadge(badge, schemaName) {
    const schemas = this.store.getAllSchemas();
    // Count references to this schema across all operations
    let count = 0;
    const paths = this.store.getPaths();
    for (const pathItem of Object.values(paths)) {
      for (const op of Object.values(pathItem)) {
        if (typeof op !== 'object' || !op) continue;
        if (op.requestBody) {
          const c = op.requestBody.content && op.requestBody.content['application/json'];
          if (c && c._schemaName === schemaName) count++;
        }
        if (op.responses) {
          for (const resp of Object.values(op.responses)) {
            const c = resp.content && resp.content['application/json'];
            if (c && c._schemaName === schemaName) count++;
          }
        }
      }
    }
    if (count > 1) {
      badge.style.display = 'inline-flex';
      badge.title = `This schema is shared by ${count} operations`;
    } else {
      badge.style.display = 'none';
    }
  }

  _linkSchema(pathStr, method, context, statusCode, schemaName) {
    const op = this.store.getOperation(pathStr, method);
    if (!op) return;
    if (context === 'requestBody') {
      if (!op.requestBody) op.requestBody = {};
      if (!op.requestBody.content) op.requestBody.content = {};
      if (!op.requestBody.content['application/json']) op.requestBody.content['application/json'] = {};
      op.requestBody.content['application/json']._schemaName = schemaName;
      op.requestBody.content['application/json'].schema = { '$ref': `#/components/schemas/${schemaName}` };
    } else {
      if (!op.responses) op.responses = {};
      if (!op.responses[statusCode]) op.responses[statusCode] = { description: 'Response', content: {} };
      if (!op.responses[statusCode].content) op.responses[statusCode].content = {};
      if (!op.responses[statusCode].content['application/json']) op.responses[statusCode].content['application/json'] = {};
      op.responses[statusCode].content['application/json']._schemaName = schemaName;
      op.responses[statusCode].content['application/json'].schema = { '$ref': `#/components/schemas/${schemaName}` };
    }
    this.store.saveOperation(pathStr, method, op);
  }

  /* ---- Prompts ---- */
  _promptAddPath() {
    const pathStr = prompt('Enter path (e.g. /api/users):');
    if (!pathStr || !pathStr.trim()) return;
    const p = pathStr.trim();
    this.store.addPath(p);
    this.renderSidebar();
    this._showToast(`Path ${p} added`, 'success');
  }

  _promptAddMethod(pathStr) {
    const methods = ['GET','POST','PUT','PATCH','DELETE','HEAD','OPTIONS'];
    const existing = Object.keys(this.store.getPaths()[pathStr] || {}).map(m => m.toUpperCase());
    const available = methods.filter(m => !existing.includes(m));
    if (!available.length) { this._showToast('All methods already added', 'info'); return; }
    const method = prompt(`Add method to ${pathStr}\nAvailable: ${available.join(', ')}`);
    if (!method || !method.trim()) return;
    const m = method.trim().toUpperCase();
    if (!methods.includes(m)) { this._showToast(`Invalid method: ${m}`, 'error'); return; }
    this.store.addMethod(pathStr, m);
    this.renderSidebar();
    this._showToast(`${m} ${pathStr} added`, 'success');
  }

  _promptAddResponse(pathStr, method) {
    const code = prompt('Enter HTTP status code (e.g. 400, 404, 500):');
    if (!code || !code.trim()) return;
    this.store.addResponse(pathStr, method, code.trim());
    this.renderSidebar();
    this._showToast(`Response ${code} added`, 'success');
  }

  _deletePath(pathStr) {
    if (!confirm(`Delete path "${pathStr}" and all its methods?`)) return;
    this.store.deletePath(pathStr);
    if (this.activeNode && this.activeNode.pathStr === pathStr) {
      this.activeNode = null;
      document.getElementById('content-panel').innerHTML = '<div class="empty-state"><i class="material-icons empty-icon">api</i><h3>Select an item</h3></div>';
    }
    this.renderSidebar();
    this._showToast(`Path ${pathStr} deleted`, 'info');
  }

  _deleteMethod(pathStr, method) {
    if (!confirm(`Delete ${method.toUpperCase()} ${pathStr}?`)) return;
    this.store.deleteMethod(pathStr, method);
    if (this.activeNode && this.activeNode.pathStr === pathStr && this.activeNode.method === method) {
      this.activeNode = null;
      document.getElementById('content-panel').innerHTML = '<div class="empty-state"><i class="material-icons empty-icon">api</i><h3>Select an item</h3></div>';
    }
    this.renderSidebar();
    this._showToast(`${method.toUpperCase()} ${pathStr} deleted`, 'info');
  }

  /* ---- Toast ---- */
  _showToast(msg, type = 'info') {
    const icons = { success: 'check_circle', error: 'error', info: 'info' };
    const container = document.getElementById('toast-container');
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.innerHTML = `<i class="material-icons">${icons[type] || 'info'}</i><span>${this._esc(msg)}</span>`;
    container.appendChild(el);
    setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity 300ms'; setTimeout(() => el.remove(), 300); }, 3000);
  }

  /* ---- Error modal ---- */
  _showErrorModal(msg) {
    document.getElementById('error-modal-body').innerHTML = `<pre>${this._esc(msg)}</pre>`;
    document.getElementById('error-modal').style.display = 'flex';
  }
  _hideErrorModal() { document.getElementById('error-modal').style.display = 'none'; }

  /* ---- Utils ---- */
  _esc(str) {
    return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }
}

/* ===========================
   BOOTSTRAP
   =========================== */
const store = new Store();
const ui = new UI(store);
