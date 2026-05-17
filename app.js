// ============================================
// STORE - управление состоянием приложения
// ============================================
class Store {
  constructor() {
    this.storageKey = 'swagger_designer_api';
    this.themeKey = 'swagger_designer_theme';
    this.loadFromStorage();
  }

  loadFromStorage() {
    const stored = localStorage.getItem(this.storageKey);
    if (stored) {
      try {
        this.api = JSON.parse(stored);
      } catch (e) {
        console.error('Ошибка загрузки API:', e);
        this.initDefaultAPI();
      }
    } else {
      this.initDefaultAPI();
    }
  }

  initDefaultAPI() {
    this.api = {
      openapi: '3.0.0',
      info: {
        title: 'Новый API',
        version: '1.0.0',
        description: ''
      },
      servers: [],
      paths: {},
      components: {
        schemas: {}
      }
    };
    this.save();
  }

  save() {
    localStorage.setItem(this.storageKey, JSON.stringify(this.api));
  }

  getTheme() {
    return localStorage.getItem(this.themeKey) || 'light';
  }

  setTheme(theme) {
    localStorage.setItem(this.themeKey, theme);
  }

  getAPI() {
    return this.api;
  }

  setAPI(api) {
    this.api = api;
    this.save();
  }

  // Методы для работы с путями и методами
  addPath(path) {
    if (!this.api.paths[path]) {
      this.api.paths[path] = {};
    }
    this.save();
  }

  deletePath(path) {
    delete this.api.paths[path];
    this.save();
  }

  addMethod(path, method) {
    if (!this.api.paths[path]) {
      this.api.paths[path] = {};
    }
    if (!this.api.paths[path][method]) {
      this.api.paths[path][method] = {
        summary: '',
        description: '',
        parameters: [],
        requestBody: null,
        responses: {}
      };
    }
    this.save();
  }

  deleteMethod(path, method) {
    if (this.api.paths[path]) {
      delete this.api.paths[path][method];
      if (Object.keys(this.api.paths[path]).length === 0) {
        this.deletePath(path);
      }
    }
    this.save();
  }

  getMethod(path, method) {
    return this.api.paths[path]?.[method];
  }

  updateMethod(path, method, data) {
    if (this.api.paths[path]) {
      this.api.paths[path][method] = { ...this.api.paths[path][method], ...data };
    }
    this.save();
  }

  // Методы для работы со схемами (реестр объектов)
  getSchema(name) {
    return this.api.components.schemas[name];
  }

  setSchema(name, schema) {
    this.api.components.schemas[name] = schema;
    this.save();
  }

  deleteSchema(name) {
    delete this.api.components.schemas[name];
    this.save();
  }

  getAllSchemaNames() {
    return Object.keys(this.api.components.schemas);
  }
}

// ============================================
// PARSER - преобразование плоских путей в вложенную структуру
// ============================================
class Parser {
  // Преобразует плоский путь (e.g., "users[].name") в вложенную структуру
  static flatPathToNested(rows) {
    const schema = { type: 'object', properties: {}, required: [] };

    rows.forEach(row => {
      const { path, type, description, example } = row;
      if (!path || !type) return;

      const parts = this.parsePath(path);
      let current = schema.properties;
      let currentDef = schema;

      parts.forEach((part, index) => {
        const isLast = index === parts.length - 1;
        const { key, isArray } = part;

        if (isLast) {
          current[key] = {
            type: isArray ? 'array' : type,
            ...(description && { description }),
            ...(example && { example })
          };

          if (isArray && type !== 'array') {
            current[key].items = { type };
          }
        } else {
          if (!current[key]) {
            current[key] = {
              type: isArray ? 'array' : 'object',
              properties: {}
            };
            if (isArray) {
              current[key].items = { type: 'object', properties: {} };
              current = current[key].items.properties;
            } else {
              current = current[key].properties;
            }
          } else {
            current = current[key][isArray ? 'items' : ''].properties || current[key].properties;
          }
        }
      });
    });

    return schema;
  }

  // Преобразует вложенную структуру обратно в плоский вид
  static nestedToFlatPath(schema, prefix = '') {
    const rows = [];

    if (schema.type === 'object' && schema.properties) {
      Object.entries(schema.properties).forEach(([key, prop]) => {
        const path = prefix ? `${prefix}.${key}` : key;
        rows.push({
          path,
          type: prop.type || 'string',
          description: prop.description || '',
          example: prop.example || ''
        });

        if (prop.type === 'object' && prop.properties) {
          rows.push(...this.nestedToFlatPath(prop, path));
        } else if (prop.type === 'array' && prop.items) {
          const arrayPath = `${path}[]`;
          if (prop.items.type === 'object' && prop.items.properties) {
            rows.push(...this.nestedToFlatPath(prop.items, arrayPath));
          }
        }
      });
    }

    return rows;
  }

  // Парсит плоский путь типа "users[].address.city"
  static parsePath(path) {
    const parts = [];
    const tokens = path.split(/(?=\[|\])/);

    let currentKey = '';
    for (const token of tokens) {
      if (token === '[' || token === ']') continue;
      if (token === '' && currentKey === '') continue;

      if (token.includes('.')) {
        const subParts = token.split('.');
        for (const part of subParts) {
          if (part) {
            parts.push({ key: part, isArray: false });
          }
        }
      } else if (token.startsWith('.')) {
        const key = token.slice(1);
        if (key) parts.push({ key, isArray: false });
      } else if (token.endsWith('[]')) {
        const key = token.slice(0, -2);
        if (key) parts.push({ key, isArray: true });
      } else {
        parts.push({ key: token, isArray: false });
      }
    }

    return parts.length > 0 ? parts : [{ key: path, isArray: false }];
  }

  // Генерирует имя схемы по пути и методу
  static generateSchemaName(path, method, type = 'Request') {
    const cleanPath = path
      .split('/')
      .filter(p => p && !p.startsWith('{'))
      .map(p => p.charAt(0).toUpperCase() + p.slice(1))
      .join('');

    const methodUpper = method.charAt(0).toUpperCase() + method.slice(1).toLowerCase();
    return `${methodUpper}${cleanPath}${type}`;
  }

  // Преобразует плоский путь в объект с $ref для OpenAPI
  static convertToRef(rows, schemaName) {
    return {
      content: {
        'application/json': {
          schema: { $ref: `#/components/schemas/${schemaName}` }
        }
      }
    };
  }
}

// ============================================
// UI - управление интерфейсом
// ============================================
class UI {
  constructor(store) {
    this.store = store;
    this.currentPath = null;
    this.currentMethod = null;
    this.currentSection = null;
    this.initEventListeners();
    this.applyTheme();
    this.render();
  }

  initEventListeners() {
    // Тема
    document.getElementById('themeToggle').addEventListener('click', () => this.toggleTheme());

    // Кнопки в хэдере
    document.getElementById('newApiBtn').addEventListener('click', () => this.showNewApiModal());
    document.getElementById('importBtn').addEventListener('click', () => this.showImportModal());
    document.getElementById('exportJsonBtn').addEventListener('click', () => this.exportJSON());
    document.getElementById('exportYamlBtn').addEventListener('click', () => this.exportYAML());

    // Редактирование метаданных API
    document.getElementById('editApiBtn').addEventListener('click', () => this.showAPIMetadataForm());
    document.getElementById('apiRootNode').addEventListener('click', (e) => {
      if (e.target.tagName !== 'BUTTON' && e.target.tagName !== 'I') {
        this.showAPIMetadataForm();
      }
    });

    // File input для импорта
    document.getElementById('fileInput').addEventListener('change', (e) => this.handleFileImport(e));

    // Модальные окна
    document.getElementById('confirmNewApi').addEventListener('click', () => this.createNewAPI());
    document.getElementById('confirmImport').addEventListener('click', () => {
      document.getElementById('fileInput').click();
      this.closeModal('importModal');
    });
  }

  applyTheme() {
    const theme = this.store.getTheme();
    if (theme === 'dark') {
      document.body.classList.add('dark-theme');
    } else {
      document.body.classList.remove('dark-theme');
    }
  }

  toggleTheme() {
    const current = this.store.getTheme();
    const newTheme = current === 'dark' ? 'light' : 'dark';
    this.store.setTheme(newTheme);
    this.applyTheme();
  }

  render() {
    this.renderSidebar();
    this.updateAPITitle();
  }

  renderSidebar() {
    const sidebar = document.getElementById('sidebarContent');
    sidebar.innerHTML = '';

    const api = this.store.getAPI();
    const paths = api.paths || {};

    if (Object.keys(paths).length === 0) {
      sidebar.innerHTML = '<div style="padding: 20px; text-align: center; color: #999;">Нет эндпоинтов</div>';
      return;
    }

    Object.entries(paths).forEach(([path, methods]) => {
      const pathNode = document.createElement('div');
      pathNode.className = 'tree-node';

      const pathHeader = document.createElement('div');
      pathHeader.className = 'tree-item';
      pathHeader.innerHTML = `
        <span class="tree-item-label">${path}</span>
        <div class="tree-item-actions">
          <button class="btn-icon-small" title="Добавить метод">+</button>
          <button class="btn-icon-small" title="Удалить путь">🗑</button>
        </div>
      `;

      pathHeader.querySelector('[title="Добавить метод"]').addEventListener('click', (e) => {
        e.stopPropagation();
        this.showAddMethodModal(path);
      });

      pathHeader.querySelector('[title="Удалить путь"]').addEventListener('click', (e) => {
        e.stopPropagation();
        if (confirm('Удалить путь и все его методы?')) {
          this.store.deletePath(path);
          this.render();
        }
      });

      const methodsContainer = document.createElement('div');
      methodsContainer.className = 'tree-children open';

      Object.keys(methods).forEach(method => {
        const methodItem = document.createElement('div');
        methodItem.className = 'tree-item';
        const methodUpper = method.toUpperCase();
        methodItem.innerHTML = `
          <span class="tree-item-label">[${methodUpper}] ${path}</span>
          <div class="tree-item-actions">
            <button class="btn-icon-small" title="Удалить метод">🗑</button>
          </div>
        `;

        methodItem.addEventListener('click', (e) => {
          if (e.target.closest('[title="Удалить метод"]')) {
            e.stopPropagation();
            if (confirm('Удалить метод?')) {
              this.store.deleteMethod(path, method);
              this.render();
            }
          } else {
            this.selectMethod(path, method);
          }
        });

        const subItemsContainer = document.createElement('div');
        subItemsContainer.className = 'tree-children open';

        ['Parameters', 'Request Body', 'Responses'].forEach(item => {
          const subItem = document.createElement('div');
          subItem.className = 'tree-item';
          subItem.style.paddingLeft = '30px';
          subItem.textContent = item;
          subItem.addEventListener('click', (e) => {
            e.stopPropagation();
            this.selectSection(path, method, item);
          });
          subItemsContainer.appendChild(subItem);
        });

        methodsContainer.appendChild(methodItem);
        methodsContainer.appendChild(subItemsContainer);
      });

      pathNode.appendChild(pathHeader);
      pathNode.appendChild(methodsContainer);
      sidebar.appendChild(pathNode);
    });

    // Кнопка для добавления нового пути
    const addPathDiv = document.createElement('div');
    addPathDiv.style.padding = '10px';
    addPathDiv.innerHTML = '<button class="btn-primary btn-small" style="width: 100%;">+ Добавить путь</button>';
    addPathDiv.querySelector('button').addEventListener('click', () => this.showAddPathModal());
    sidebar.appendChild(addPathDiv);
  }

  selectMethod(path, method) {
    this.currentPath = path;
    this.currentMethod = method;
    this.currentSection = null;
    this.renderMethodInfo();
  }

  selectSection(path, method, section) {
    this.currentPath = path;
    this.currentMethod = method;
    this.currentSection = section;
    this.renderSection();
  }

  renderMethodInfo() {
    const content = document.getElementById('contentArea');
    const methodData = this.store.getMethod(this.currentPath, this.currentMethod);

    content.innerHTML = `
      <div class="form-group">
        <h2>[${this.currentMethod.toUpperCase()}] ${this.currentPath}</h2>
      </div>
      <div class="form-group">
        <label>Описание</label>
        <textarea id="methodDescription" placeholder="Описание метода">${methodData.description || ''}</textarea>
      </div>
      <button class="btn-primary btn-small" id="saveMethodBtn">Сохранить</button>
    `;

    document.getElementById('saveMethodBtn').addEventListener('click', () => {
      const description = document.getElementById('methodDescription').value;
      this.store.updateMethod(this.currentPath, this.currentMethod, { description });
      this.showNotification('Метод обновлен');
    });
  }

  renderSection() {
    const content = document.getElementById('contentArea');
    const methodData = this.store.getMethod(this.currentPath, this.currentMethod);

    if (this.currentSection === 'Parameters') {
      this.renderParametersTable(methodData);
    } else if (this.currentSection === 'Request Body') {
      this.renderRequestBodyForm(methodData);
    } else if (this.currentSection === 'Responses') {
      this.renderResponsesForm(methodData);
    }
  }

  renderParametersTable(methodData) {
    const content = document.getElementById('contentArea');
    const params = methodData.parameters || [];

    let html = `
      <h2>Параметры</h2>
      <table>
        <thead>
          <tr>
            <th>Тип</th>
            <th>Имя</th>
            <th>Описание</th>
            <th>Пример</th>
            <th>Действие</th>
          </tr>
        </thead>
        <tbody id="paramsTable">
    `;

    params.forEach((param, index) => {
      html += `
        <tr>
          <td><select class="param-type" data-index="${index}">
            <option ${param.in === 'query' ? 'selected' : ''}>query</option>
            <option ${param.in === 'path' ? 'selected' : ''}>path</option>
            <option ${param.in === 'header' ? 'selected' : ''}>header</option>
            <option ${param.in === 'cookie' ? 'selected' : ''}>cookie</option>
          </select></td>
          <td><input type="text" class="param-name" value="${param.name || ''}" data-index="${index}"></td>
          <td><input type="text" class="param-desc" value="${param.description || ''}" data-index="${index}"></td>
          <td><input type="text" class="param-example" value="${param.example || ''}" data-index="${index}"></td>
          <td><button class="btn-danger btn-small" onclick="ui.removeParameter(${index})">Удалить</button></td>
        </tr>
      `;
    });

    html += `
        </tbody>
      </table>
      <button class="btn-primary btn-small" id="addParamBtn" style="margin-top: 10px;">+ Добавить параметр</button>
    `;

    content.innerHTML = html;

    document.querySelectorAll('.param-type, .param-name, .param-desc, .param-example').forEach(el => {
      el.addEventListener('change', () => this.saveParameters());
      el.addEventListener('input', () => this.saveParameters());
    });

    document.getElementById('addParamBtn').addEventListener('click', () => this.addParameter());
  }

  saveParameters() {
    const rows = document.querySelectorAll('#paramsTable tr');
    const params = Array.from(rows).map(row => ({
      in: row.querySelector('.param-type').value,
      name: row.querySelector('.param-name').value,
      description: row.querySelector('.param-desc').value,
      example: row.querySelector('.param-example').value,
      required: false,
      schema: { type: 'string' }
    }));

    this.store.updateMethod(this.currentPath, this.currentMethod, { parameters: params });
  }

  addParameter() {
    const methodData = this.store.getMethod(this.currentPath, this.currentMethod);
    methodData.parameters = methodData.parameters || [];
    methodData.parameters.push({
      in: 'query',
      name: 'param_' + Date.now(),
      description: '',
      example: '',
      required: false,
      schema: { type: 'string' }
    });
    this.store.updateMethod(this.currentPath, this.currentMethod, methodData);
    this.renderParametersTable(methodData);
  }

  removeParameter(index) {
    const methodData = this.store.getMethod(this.currentPath, this.currentMethod);
    methodData.parameters.splice(index, 1);
    this.store.updateMethod(this.currentPath, this.currentMethod, methodData);
    this.renderParametersTable(methodData);
  }

  renderRequestBodyForm(methodData) {
    const content = document.getElementById('contentArea');
    const requestBody = methodData.requestBody;
    const schemaName = requestBody?.['x-schema-name'] || '';
    const rows = requestBody ? Parser.nestedToFlatPath(requestBody.content['application/json'].schema) : [];

    let html = `
      <h2>Request Body</h2>
      <div class="form-group">
        <label>Имя объекта</label>
        <input type="text" id="schemaName" value="${schemaName}" placeholder="Имя схемы">
      </div>
      <table>
        <thead>
          <tr>
            <th>Путь к значению</th>
            <th>Тип данных</th>
            <th>Описание</th>
            <th>Пример</th>
            <th>Действие</th>
          </tr>
        </thead>
        <tbody id="requestBodyTable">
    `;

    rows.forEach((row, index) => {
      html += `
        <tr>
          <td><input type="text" class="field-path" value="${row.path}" data-index="${index}"></td>
          <td><select class="field-type" data-index="${index}">
            <option ${row.type === 'string' ? 'selected' : ''}>string</option>
            <option ${row.type === 'integer' ? 'selected' : ''}>integer</option>
            <option ${row.type === 'number' ? 'selected' : ''}>number</option>
            <option ${row.type === 'boolean' ? 'selected' : ''}>boolean</option>
            <option ${row.type === 'array' ? 'selected' : ''}>array</option>
            <option ${row.type === 'object' ? 'selected' : ''}>object</option>
          </select></td>
          <td><input type="text" class="field-desc" value="${row.description || ''}" data-index="${index}"></td>
          <td><input type="text" class="field-example" value="${row.example || ''}" data-index="${index}"></td>
          <td><button class="btn-danger btn-small" onclick="ui.removeField('request', ${index})">Удалить</button></td>
        </tr>
      `;
    });

    html += `
        </tbody>
      </table>
      <button class="btn-primary btn-small" id="addFieldBtn" style="margin-top: 10px;">+ Добавить поле</button>
      <button class="btn-success btn-small" id="saveRequestBtn" style="margin-top: 10px;">Сохранить Request Body</button>
    `;

    content.innerHTML = html;

    document.querySelectorAll('.field-path, .field-type, .field-desc, .field-example').forEach(el => {
      el.addEventListener('change', () => {});
    });

    document.getElementById('addFieldBtn').addEventListener('click', () => this.addField('request'));
    document.getElementById('saveRequestBtn').addEventListener('click', () => this.saveRequestBody());
  }

  saveRequestBody() {
    const schemaName = document.getElementById('schemaName').value || Parser.generateSchemaName(this.currentPath, this.currentMethod, 'Request');
    const rows = document.querySelectorAll('#requestBodyTable tr');
    const fields = Array.from(rows).map(row => ({
      path: row.querySelector('.field-path').value,
      type: row.querySelector('.field-type').value,
      description: row.querySelector('.field-desc').value,
      example: row.querySelector('.field-example').value
    }));

    const schema = Parser.flatPathToNested(fields);
    this.store.setSchema(schemaName, schema);

    const requestBody = {
      required: true,
      content: {
        'application/json': {
          schema: { $ref: `#/components/schemas/${schemaName}` }
        }
      },
      'x-schema-name': schemaName
    };

    this.store.updateMethod(this.currentPath, this.currentMethod, { requestBody });
    this.showNotification('Request Body сохранен');
  }

  renderResponsesForm(methodData) {
    const content = document.getElementById('contentArea');
    const responses = methodData.responses || {};

    let html = '<h2>Responses</h2>';

    Object.entries(responses).forEach(([code, response]) => {
      const schemaName = response['x-schema-name'] || '';
      const rows = response.content?.['application/json'] ? Parser.nestedToFlatPath(response.content['application/json'].schema) : [];

      html += `
        <h3>Ответ ${code}</h3>
        <div class="form-group">
          <label>Имя объекта</label>
          <input type="text" class="response-schema-name" value="${schemaName}" data-code="${code}">
        </div>
        <table>
          <thead>
            <tr>
              <th>Путь к значению</th>
              <th>Тип данных</th>
              <th>Описание</th>
              <th>Пример</th>
              <th>Действие</th>
            </tr>
          </thead>
          <tbody class="response-table" data-code="${code}">
      `;

      rows.forEach((row, index) => {
        html += `
          <tr>
            <td><input type="text" class="field-path" value="${row.path}" data-index="${index}"></td>
            <td><select class="field-type" data-index="${index}">
              <option ${row.type === 'string' ? 'selected' : ''}>string</option>
              <option ${row.type === 'integer' ? 'selected' : ''}>integer</option>
              <option ${row.type === 'number' ? 'selected' : ''}>number</option>
              <option ${row.type === 'boolean' ? 'selected' : ''}>boolean</option>
              <option ${row.type === 'array' ? 'selected' : ''}>array</option>
              <option ${row.type === 'object' ? 'selected' : ''}>object</option>
            </select></td>
            <td><input type="text" class="field-desc" value="${row.description || ''}" data-index="${index}"></td>
            <td><input type="text" class="field-example" value="${row.example || ''}" data-index="${index}"></td>
            <td><button class="btn-danger btn-small" onclick="ui.removeResponseField('${code}', ${index})">Удалить</button></td>
          </tr>
        `;
      });

      html += `
          </tbody>
        </table>
        <button class="btn-secondary btn-small" onclick="ui.addResponseField('${code}')">+ Добавить поле</button>
        <button class="btn-danger btn-small" onclick="ui.removeResponse('${code}')">Удалить ответ ${code}</button>
      `;
    });

    html += `
      <div style="margin-top: 20px;">
        <label>Добавить новый ответ</label>
        <input type="text" id="newResponseCode" placeholder="200, 400, 404...">
        <button class="btn-primary btn-small" id="addResponseBtn">+ Добавить ответ</button>
      </div>
      <button class="btn-success btn-small" id="saveResponsesBtn" style="margin-top: 20px;">Сохранить Responses</button>
    `;

    content.innerHTML = html;

    document.getElementById('addResponseBtn').addEventListener('click', () => this.addResponse());
    document.getElementById('saveResponsesBtn').addEventListener('click', () => this.saveResponses());
  }

  addResponse() {
    const code = document.getElementById('newResponseCode').value || '200';
    const methodData = this.store.getMethod(this.currentPath, this.currentMethod);
    methodData.responses = methodData.responses || {};

    if (!methodData.responses[code]) {
      methodData.responses[code] = {
        description: `Response ${code}`,
        content: {
          'application/json': {
            schema: { type: 'object', properties: {} }
          }
        },
        'x-schema-name': Parser.generateSchemaName(this.currentPath, this.currentMethod, `Response${code}`)
      };
      this.store.updateMethod(this.currentPath, this.currentMethod, methodData);
      this.renderResponsesForm(methodData);
    }
  }

  removeResponse(code) {
    const methodData = this.store.getMethod(this.currentPath, this.currentMethod);
    delete methodData.responses[code];
    this.store.updateMethod(this.currentPath, this.currentMethod, methodData);
    this.renderResponsesForm(methodData);
  }

  addResponseField(code) {
    const methodData = this.store.getMethod(this.currentPath, this.currentMethod);
    const response = methodData.responses[code];

    if (response && response.content['application/json']) {
      const schema = response.content['application/json'].schema;
      schema.properties = schema.properties || {};
      schema.properties['field_' + Date.now()] = { type: 'string' };
    }

    this.store.updateMethod(this.currentPath, this.currentMethod, methodData);
    this.renderResponsesForm(methodData);
  }

  removeResponseField(code, index) {
    const methodData = this.store.getMethod(this.currentPath, this.currentMethod);
    const response = methodData.responses[code];

    if (response && response.content['application/json']) {
      const keys = Object.keys(response.content['application/json'].schema.properties || {});
      if (keys[index]) {
        delete response.content['application/json'].schema.properties[keys[index]];
      }
    }

    this.store.updateMethod(this.currentPath, this.currentMethod, methodData);
    this.renderResponsesForm(methodData);
  }

  saveResponses() {
    const methodData = this.store.getMethod(this.currentPath, this.currentMethod);

    document.querySelectorAll('.response-table').forEach(table => {
      const code = table.getAttribute('data-code');
      const schemaName = document.querySelector(`input[data-code="${code}"]`).value || Parser.generateSchemaName(this.currentPath, this.currentMethod, `Response${code}`);
      const rows = Array.from(table.querySelectorAll('tr')).map(row => ({
        path: row.querySelector('.field-path').value,
        type: row.querySelector('.field-type').value,
        description: row.querySelector('.field-desc').value,
        example: row.querySelector('.field-example').value
      }));

      const schema = Parser.flatPathToNested(rows);
      this.store.setSchema(schemaName, schema);

      methodData.responses[code] = {
        description: `Response ${code}`,
        content: {
          'application/json': {
            schema: { $ref: `#/components/schemas/${schemaName}` }
          }
        },
        'x-schema-name': schemaName
      };
    });

    this.store.updateMethod(this.currentPath, this.currentMethod, methodData);
    this.showNotification('Responses сохранены');
  }

  addField(type) {
    if (type === 'request') {
      const tbody = document.getElementById('requestBodyTable');
      const newRow = document.createElement('tr');
      const index = tbody.querySelectorAll('tr').length;
      newRow.innerHTML = `
        <td><input type="text" class="field-path" value="field_${Date.now()}" data-index="${index}"></td>
        <td><select class="field-type" data-index="${index}">
          <option>string</option>
          <option>integer</option>
          <option>number</option>
          <option>boolean</option>
          <option>array</option>
          <option>object</option>
        </select></td>
        <td><input type="text" class="field-desc" value="" data-index="${index}"></td>
        <td><input type="text" class="field-example" value="" data-index="${index}"></td>
        <td><button class="btn-danger btn-small" onclick="ui.removeField('request', ${index})">Удалить</button></td>
      `;
      tbody.appendChild(newRow);
    }
  }

  removeField(type, index) {
    const tableId = type === 'request' ? 'requestBodyTable' : null;
    if (tableId) {
      const tbody = document.getElementById(tableId);
      const rows = tbody.querySelectorAll('tr');
      if (rows[index]) {
        rows[index].remove();
      }
    }
  }

  showAPIMetadataForm() {
    const api = this.store.getAPI();
    const info = api.info;
    const servers = api.servers || [];

    const content = document.getElementById('contentArea');
    let html = `
      <h2>Метаданные API</h2>
      <div class="form-group">
        <label>Название</label>
        <input type="text" id="apiTitle" value="${info.title}">
      </div>
      <div class="form-group">
        <label>Версия</label>
        <input type="text" id="apiVersion" value="${info.version}">
      </div>
      <div class="form-group">
        <label>Описание</label>
        <textarea id="apiDescription">${info.description || ''}</textarea>
      </div>
      <div class="form-group">
        <label>Серверы</label>
        <div id="serversContainer">
    `;

    servers.forEach((server, index) => {
      html += `
        <div class="server-item">
          <input type="text" class="server-url" value="${server.url}" data-index="${index}">
          <button class="btn-danger btn-small" onclick="ui.removeServer(${index})">Удалить</button>
        </div>
      `;
    });

    html += `
        </div>
        <button class="btn-secondary btn-small" id="addServerBtn">+ Добавить сервер</button>
      </div>
      <button class="btn-success btn-small" id="saveApiBtn">Сохранить</button>
    `;

    content.innerHTML = html;

    document.getElementById('addServerBtn').addEventListener('click', () => this.addServer());
    document.getElementById('saveApiBtn').addEventListener('click', () => this.saveAPIMetadata());
  }

  addServer() {
    const container = document.getElementById('serversContainer');
    const newServer = document.createElement('div');
    const index = container.querySelectorAll('.server-item').length;
    newServer.className = 'server-item';
    newServer.innerHTML = `
      <input type="text" class="server-url" placeholder="https://api.example.com" data-index="${index}">
      <button class="btn-danger btn-small" onclick="ui.removeServer(${index})">Удалить</button>
    `;
    container.appendChild(newServer);
  }

  removeServer(index) {
    const items = document.querySelectorAll('.server-item');
    if (items[index]) {
      items[index].remove();
    }
  }

  saveAPIMetadata() {
    const api = this.store.getAPI();
    api.info.title = document.getElementById('apiTitle').value;
    api.info.version = document.getElementById('apiVersion').value;
    api.info.description = document.getElementById('apiDescription').value;

    api.servers = Array.from(document.querySelectorAll('.server-url')).map(el => ({
      url: el.value
    }));

    this.store.setAPI(api);
    this.updateAPITitle();
    this.showNotification('Метаданные сохранены');
  }

  updateAPITitle() {
    const api = this.store.getAPI();
    document.getElementById('apiName').textContent = api.info.title || 'Новый API';
  }

  showAddPathModal() {
    const path = prompt('Введите путь (например: /api/users)');
    if (path) {
      this.store.addPath(path);
      this.render();
    }
  }

  showAddMethodModal(path) {
    const method = prompt('Введите метод (GET, POST, PUT, DELETE, PATCH)');
    if (method && ['get', 'post', 'put', 'delete', 'patch'].includes(method.toLowerCase())) {
      this.store.addMethod(path, method.toLowerCase());
      this.render();
    } else if (method) {
      this.showError('Неверный метод HTTP');
    }
  }

  showNewApiModal() {
    this.openModal('newApiModal');
  }

  showImportModal() {
    this.openModal('importModal');
  }

  createNewAPI() {
    this.store.initDefaultAPI();
    this.render();
    this.showNotification('Создан новый API');
  }

  handleFileImport(e) {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        let api;
        if (file.name.endsWith('.json')) {
          api = JSON.parse(event.target.result);
        } else if (file.name.endsWith('.yml') || file.name.endsWith('.yaml')) {
          api = jsYaml.load(event.target.result);
        } else {
          throw new Error('Неподдерживаемый формат файла');
        }

        if (!api.openapi && !api.swagger) {
          throw new Error('Файл не является валидной OpenAPI спецификацией');
        }

        this.store.setAPI(api);
        this.render();
        this.showNotification('API успешно импортирован');
      } catch (error) {
        this.showError(`Ошибка импорта: ${error.message}`);
      }
    };
    reader.readAsText(file);
  }

  exportJSON() {
    const api = this.store.getAPI();
    const dataStr = JSON.stringify(api, null, 2);
    this.downloadFile(dataStr, `${api.info.title}.json`, 'application/json');
  }

  exportYAML() {
    const api = this.store.getAPI();
    const yamlStr = jsYaml.dump(api);
    this.downloadFile(yamlStr, `${api.info.title}.yaml`, 'text/yaml');
  }

  downloadFile(content, filename, type) {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  openModal(modalId) {
    document.getElementById(modalId).classList.add('open');
    document.getElementById(modalId).addEventListener('click', (e) => {
      if (e.target.id === modalId) {
        this.closeModal(modalId);
      }
    });
  }

  closeModal(modalId) {
    document.getElementById(modalId).classList.remove('open');
  }

  showError(message) {
    const modal = document.getElementById('errorModal');
    document.getElementById('errorMessage').textContent = message;
    this.openModal('errorModal');
  }

  showNotification(message) {
    const contentArea = document.getElementById('contentArea');
    const alert = document.createElement('div');
    alert.className = 'alert alert-success';
    alert.innerHTML = `<i class="material-icons">check_circle</i><span>${message}</span>`;
    contentArea.insertBefore(alert, contentArea.firstChild);

    setTimeout(() => {
      alert.remove();
    }, 3000);
  }
}

// ============================================
// Инициализация приложения
// ============================================
const store = new Store();
const ui = new UI(store);
