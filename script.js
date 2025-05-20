document.addEventListener('DOMContentLoaded', () => {
    // --- Configuration Store ---
    let config = {
        app: null,
        originators: [],
        srvMatrix: [],
        openapiExecutor: null
    };

    // --- UI Elements ---
    const environmentSelect = document.getElementById('environmentSelect');
    const roleSelect = document.getElementById('roleSelect');
    const duisVersionSelect = document.getElementById('duisVersionSelect');
    const originatorNameDisplay = document.getElementById('originatorNameDisplay');
    const srvSelect = document.getElementById('srvSelect');
    const cvSelect = document.getElementById('cvSelect');
    const futureDateContainer = document.getElementById('futureDateContainer');
    const executionDateTimeInput = document.getElementById('executionDateTime');
    const targetGuidContainer = document.getElementById('targetGuidContainer');
    const targetGuidInput = document.getElementById('targetGuid');
    const targetCv8DisplayContainer = document.getElementById('targetCv8DisplayContainer');
    const targetCv8Display = document.getElementById('targetCv8Display');
    const srvSpecificForm = document.getElementById('srvSpecificForm');

    const generateJsonButton = document.getElementById('generateJsonButton');
    const jsonOutput = document.getElementById('jsonOutput');
    const curlOutput = document.getElementById('curlOutput');
    const copyJsonButton = document.getElementById('copyJsonButton');
    const copyCurlButton = document.getElementById('copyCurlButton');

    // --- State Store ---
    let currentState = {
        selectedEnvironment: null,
        selectedRole: null,
        selectedDuisVersion: null,
        determinedOriginatorName: null,
        selectedSrvData: null,
        selectedSrvSchema: null,
        selectedCv: null,
        futureDateTimeValue: null,
        targetValue: null,
        formBodyParams: {}
    };

    // --- Helper: CSV Parser ---
    function parseCSV(csvText) {
        const lines = csvText.trim().split('\n');
        const headers = lines[0].split(',').map(h => h.trim());
        const data = [];
        for (let i = 1; i < lines.length; i++) {
            const values = lines[i].split(',').map(v => v.trim());
            if (values.length === headers.length) {
                const entry = {};
                headers.forEach((header, index) => {
                    entry[header] = values[index];
                });
                data.push(entry);
            }
        }
        return data;
    }

    // --- Configuration Loading ---
    async function loadConfigurations() {
        try {
            const [appRes, originatorRes, srvMatrixRes, openapiRes] = await Promise.all([
                fetch('config/app-config.json'),
                fetch('config/OriginatorNameList.csv'),
                fetch('config/srv-matrix-config.json'),
                fetch('config/openapi-adaptor-request-executor.json')
            ]);

            if (!appRes.ok) throw new Error(`Failed to fetch app-config.json: ${appRes.status} ${appRes.statusText}`);
            if (!originatorRes.ok) throw new Error(`Failed to fetch OriginatorNameList.csv: ${originatorRes.status} ${originatorRes.statusText}`);
            if (!srvMatrixRes.ok) throw new Error(`Failed to fetch srv-matrix-config.json: ${srvMatrixRes.status} ${srvMatrixRes.statusText}`);
            if (!openapiRes.ok) throw new Error(`Failed to fetch openapi-adaptor-request-executor.json: ${openapiRes.status} ${openapiRes.statusText}`);

            config.app = await appRes.json();
            config.originators = parseCSV(await originatorRes.text());
            config.srvMatrix = await srvMatrixRes.json();
            config.openapiExecutor = await openapiRes.json();

            initializeUI();
        } catch (error) {
            console.error("Error loading configurations:", error);
            alert(`Failed to load configurations. Check console. Error: ${error.message}`);
        }
    }

    // --- UI Initialization and Population Logic ---
    function initializeUI() {
        populateEnvironments();
        populateRoles();
        setupEventListeners();
    }

    function populateEnvironments() {
        if (config.app && config.app.environments && Array.isArray(config.app.environments)) {
            config.app.environments.forEach(env => {
                if (env && typeof env.name === 'string') {
                    const option = document.createElement('option');
                    option.value = JSON.stringify(env);
                    option.textContent = env.name;
                    environmentSelect.appendChild(option);
                }
            });
        } else {
            console.error("app-config.json data for environments is invalid.");
        }
    }

    function populateRoles() {
        config.app.roles.forEach(role => {
            const option = document.createElement('option');
            option.value = JSON.stringify(role);
            option.textContent = role.fullName;
            roleSelect.appendChild(option);
        });
    }

    function populateDuisVersions() {
        duisVersionSelect.innerHTML = '<option value="">-- Select DUIS Version --</option>';
        if (!currentState.selectedEnvironment || !currentState.selectedRole) {
            duisVersionSelect.disabled = true;
            return;
        }
        const relevantOriginators = config.originators.filter(org =>
            org.Environment === currentState.selectedEnvironment.name &&
            org['User Role'] === currentState.selectedRole.abbreviation
        );
        const duisVersions = [...new Set(relevantOriginators.map(org => org['DUIS Version']))].sort((a, b) => parseFloat(a) - parseFloat(b));
        duisVersions.forEach(version => {
            const option = document.createElement('option');
            option.value = version;
            option.textContent = version;
            duisVersionSelect.appendChild(option);
        });
        duisVersionSelect.disabled = duisVersions.length === 0;
    }

    function displayOriginatorNameAndPopulateSrvs() {
        originatorNameDisplay.textContent = "N/A";
        currentState.determinedOriginatorName = null;
        if (currentState.selectedEnvironment && currentState.selectedRole && currentState.selectedDuisVersion) {
            const foundOriginator = config.originators.find(org =>
                org.Environment === currentState.selectedEnvironment.name &&
                org['User Role'] === currentState.selectedRole.abbreviation &&
                org['DUIS Version'] === currentState.selectedDuisVersion
            );
            if (foundOriginator && foundOriginator.originatorName) {
                currentState.determinedOriginatorName = foundOriginator.originatorName;
                originatorNameDisplay.textContent = currentState.determinedOriginatorName;
            } else {
                originatorNameDisplay.textContent = "No Originator found for selection.";
            }
        }
        populateSrvs();
    }

    function populateSrvs() {
        resetDownstreamUI('srv');
        srvSelect.innerHTML = '<option value="">-- Select SRV --</option>';
        if (!currentState.selectedRole || !currentState.determinedOriginatorName) {
            srvSelect.disabled = true;
            return;
        }
        const roleAbbrev = currentState.selectedRole.abbreviation;
        let matrixRoleFilter = roleAbbrev;
        if (roleAbbrev.startsWith("IS")) matrixRoleFilter = "IS";
        if (roleAbbrev.startsWith("GS")) matrixRoleFilter = "GS";
        const eligibleSrvs = config.srvMatrix.filter(srv => {
            if (!srv.eligible_user_roles.includes(matrixRoleFilter)) return false;
            return true;
        }).sort((a, b) => {
            const aParts = a.srv_code.split('.').map(Number);
            const bParts = b.srv_code.split('.').map(Number);
            for (let i = 0; i < Math.max(aParts.length, bParts.length); i++) {
                const valA = aParts[i] || 0;
                const valB = bParts[i] || 0;
                if (valA < valB) return -1;
                if (valA > valB) return 1;
            }
            return 0;
        });
        eligibleSrvs.forEach(srv => {
            const option = document.createElement('option');
            option.value = srv.srv_code;
            option.textContent = `${srv.srv_code} - ${srv.srv_name}`;
            srvSelect.appendChild(option);
        });
        srvSelect.disabled = eligibleSrvs.length === 0;
    }

    function handleSrvSelection() {
        const srvCode = srvSelect.value;
        currentState.selectedSrvData = config.srvMatrix.find(srv => srv.srv_code === srvCode) || null;
        currentState.selectedSrvSchema = null;
        resetDownstreamUI('srv');
        if (currentState.selectedSrvData) {
            cvSelect.disabled = false;
            populateCvSelectAndForm();
        } else {
            cvSelect.disabled = true;
        }
    }

    function populateCvSelectAndForm() {
        cvSelect.innerHTML = '<option value="">-- Select CV --</option>';
        currentState.selectedCv = null;
        if (!currentState.selectedSrvData) {
            cvSelect.disabled = true;
            return;
        }
        currentState.selectedSrvData.command_variants.forEach(cv => {
            const option = document.createElement('option');
            option.value = cv;
            option.textContent = cv;
            cvSelect.appendChild(option);
        });
        cvSelect.disabled = currentState.selectedSrvData.command_variants.length === 0;
        const shouldShowFutureDate = currentState.selectedSrvData.supports_future_date;
        futureDateContainer.style.display = shouldShowFutureDate ? 'block' : 'none';
        if (!shouldShowFutureDate) {
            executionDateTimeInput.value = '';
            currentState.futureDateTimeValue = null;
        } else {
            executionDateTimeInput.value = currentState.futureDateTimeValue || '';
        }
        generateDynamicSrvForm();
    }

    function handleCvSelection() {
        currentState.selectedCv = cvSelect.value ? parseInt(cvSelect.value, 10) : null;
        targetGuidContainer.style.display = 'none';
        targetGuidInput.value = '';
        targetCv8DisplayContainer.style.display = 'none';
        targetCv8Display.textContent = 'N/A';
        currentState.targetValue = null;
        generateJsonButton.disabled = true;
        jsonOutput.textContent = '{}';
        curlOutput.textContent = 'curl ...';
        if (currentState.selectedCv !== null) {
            handleTargetField();
        }
    }

    function handleTargetField() {
        targetGuidContainer.style.display = 'none';
        targetCv8DisplayContainer.style.display = 'none';
        if (!currentState.selectedCv || !currentState.selectedEnvironment) {
            generateJsonButton.disabled = true;
            return;
        }
        const cvIsEight = currentState.selectedCv === 8;
        if (cvIsEight) {
            currentState.targetValue = currentState.selectedEnvironment.target_eui64_cv8;
            targetCv8Display.textContent = currentState.targetValue;
            targetCv8DisplayContainer.style.display = 'block';
            targetGuidInput.value = '';
            generateJsonButton.disabled = !currentState.targetValue;
        } else {
            targetGuidContainer.style.display = 'block';
            if (currentState.targetValue && currentState.targetValue !== currentState.selectedEnvironment.target_eui64_cv8) {
                targetGuidInput.value = currentState.targetValue;
            } else {
                targetGuidInput.value = '';
                currentState.targetValue = '';
            }
            targetCv8Display.textContent = 'N/A';
            generateJsonButton.disabled = !targetGuidInput.value.trim();
        }
    }

    function resetDownstreamUI(fromStep) {
        const stepsToClear = {
            environment: ['role', 'duis', 'originator', 'srv', 'cv', 'form', 'target', 'output'],
            role: ['duis', 'originator', 'srv', 'cv', 'form', 'target', 'output'],
            duis: ['originator', 'srv', 'cv', 'form', 'target', 'output'],
            srv: ['cv', 'form', 'target', 'output'],
            cv: ['target', 'output']
        };
        const toClear = stepsToClear[fromStep] || [];
        if (toClear.includes('role')) {
            roleSelect.selectedIndex = 0; currentState.selectedRole = null; roleSelect.disabled = true;
        }
        if (toClear.includes('duis')) {
            duisVersionSelect.innerHTML = '<option value="">-- Select DUIS Version --</option>';
            duisVersionSelect.disabled = true; currentState.selectedDuisVersion = null;
        }
        if (toClear.includes('originator')) {
            originatorNameDisplay.textContent = "N/A"; currentState.determinedOriginatorName = null;
        }
        if (toClear.includes('srv')) {
            srvSelect.innerHTML = '<option value="">-- Select SRV --</option>';
            srvSelect.disabled = true; currentState.selectedSrvData = null; currentState.selectedSrvSchema = null;
        }
        if (toClear.includes('cv')) {
            cvSelect.innerHTML = '<option value="">-- Select CV --</option>';
            cvSelect.disabled = true; currentState.selectedCv = null;
        }
        if (toClear.includes('form')) {
            srvSpecificForm.innerHTML = '<p>SRV specific fields will appear here.</p>';
            currentState.formBodyParams = {};
            futureDateContainer.style.display = 'none';
            executionDateTimeInput.value = '';
            currentState.futureDateTimeValue = null;
        }
        if (toClear.includes('target')) {
            targetGuidContainer.style.display = 'none'; targetGuidInput.value = '';
            targetCv8DisplayContainer.style.display = 'none'; targetCv8Display.textContent = 'N/A';
            currentState.targetValue = null;
        }
        if (toClear.includes('output')) {
            generateJsonButton.disabled = true;
            jsonOutput.textContent = '{}';
            curlOutput.textContent = 'curl ...';
        }
        if (!currentState.selectedEnvironment) roleSelect.disabled = true;
        if (!currentState.selectedRole || !currentState.selectedEnvironment) duisVersionSelect.disabled = true;
        if (!currentState.determinedOriginatorName) srvSelect.disabled = true;
        if (!currentState.selectedSrvData) cvSelect.disabled = true;
        if (!currentState.selectedCv || !currentState.targetValue) generateJsonButton.disabled = true;
        else if (String(currentState.selectedCv) !== "8" && !targetGuidInput.value.trim()) generateJsonButton.disabled = true;
        else generateJsonButton.disabled = false;
    }

    // --- Schema Resolver ---
    function getSchema(ref) {
        if (!ref || !ref.startsWith('#/')) {
            console.warn("Invalid or non-internal $ref:", ref);
            return null;
        }
        const parts = ref.substring(2).split('/');
        let current = config.openapiExecutor;
        for (const part of parts) {
            if (current && typeof current === 'object' && part in current) {
                current = current[part];
            } else {
                console.error("Could not resolve $ref part:", part, "in ref:", ref, "Current schema object:", current);
                return null;
            }
        }
        return current;
    }

    // --- Dynamic Form Generation ---
    function generateDynamicSrvForm() {
        srvSpecificForm.innerHTML = '';
        if (!currentState.selectedSrvData || !config.openapiExecutor) {
            srvSpecificForm.innerHTML = '<p>SRV not selected or OpenAPI spec not loaded.</p>';
            return;
        }
        const srvPath = `/v1/request-executor/srv/${currentState.selectedSrvData.srv_code}`;
        const srvOperation = config.openapiExecutor.paths[srvPath]?.post;
        if (!srvOperation) {
            srvSpecificForm.innerHTML = `<p>Error: OpenAPI definition not found for SRV path ${srvPath}.</p>`;
            return;
        }
        const requestBodySchemaRef = srvOperation.requestBody?.content?.['application/json']?.schema?.$ref;
        if (!requestBodySchemaRef) {
            srvSpecificForm.innerHTML = `<p>Error: Request body schema reference not found for SRV ${currentState.selectedSrvData.srv_code}.</p>`;
            return;
        }
        const srvDtoSchema = getSchema(requestBodySchemaRef);
        if (!srvDtoSchema) {
            srvSpecificForm.innerHTML = `<p>Error: Could not resolve SRV DTO schema: ${requestBodySchemaRef}.</p>`;
            return;
        }
        currentState.selectedSrvSchema = srvDtoSchema;
        const bodyParamsPropertySchema = srvDtoSchema.properties?.bodyParameters;
        const formFragment = document.createDocumentFragment();
        if (srvDtoSchema.properties?.executionDateTime && currentState.selectedSrvData.supports_future_date) {
            // handled by #executionDateTime
        }
        if (!bodyParamsPropertySchema) {
            if (!srvDtoSchema.properties?.executionDateTime || !currentState.selectedSrvData.supports_future_date) {
                srvSpecificForm.innerHTML = `<p>This SRV has no configurable body parameters.</p>`;
            }
            return;
        }
        const bodyParamsSchemaActual = bodyParamsPropertySchema.$ref ? getSchema(bodyParamsPropertySchema.$ref) : bodyParamsPropertySchema;
        if (!bodyParamsSchemaActual) {
            srvSpecificForm.innerHTML = `<p>Error: Could not resolve bodyParameters schema. Ref: ${bodyParamsPropertySchema.$ref || 'inline'}</p>`;
            return;
        }
        if (bodyParamsSchemaActual.type === 'object' && (!bodyParamsSchemaActual.properties || Object.keys(bodyParamsSchemaActual.properties).length === 0) && !bodyParamsSchemaActual.additionalProperties) {
            srvSpecificForm.innerHTML = `<p>This SRV has an empty 'bodyParameters' object (no specific fields to fill).</p>`;
        } else {
            buildFormFieldsRecursive(bodyParamsSchemaActual, formFragment, 'formBodyParams', bodyParamsSchemaActual.required || []);
            srvSpecificForm.appendChild(formFragment);
        }
    }

    function buildFormFieldsRecursive(schema, parentElement, parentDataPath, parentSchemaRequired = []) {
        if (!schema) return;
        if (schema.type && schema.type !== 'object' && schema.type !== 'array') {
            const fieldName = parentDataPath.split('.').pop();
            const inputElement = createFormFieldElement(fieldName, schema, parentDataPath, parentSchemaRequired.includes(fieldName));
            if (inputElement) parentElement.appendChild(inputElement);
            return;
        }
        if (!schema.properties && schema.type === 'object' && !schema.additionalProperties) {
            return;
        }
        if (!schema.properties) return;
        const currentSchemaRequired = schema.required || [];
        for (const key in schema.properties) {
            const propertySchema = schema.properties[key];
            const currentDataPath = `${parentDataPath}.${key}`;
            const isRequired = currentSchemaRequired.includes(key);
            const fieldContainer = document.createElement('div');
            fieldContainer.classList.add('form-field');
            if (propertySchema.type === 'object' && propertySchema.properties) {
                fieldContainer.classList.add('object-field');
            }
            const label = document.createElement('label');
            label.htmlFor = currentDataPath.replace(/[.\[\]]/g, '_');
            label.textContent = propertySchema.title || propertySchema.description || key;
            if (isRequired) {
                label.textContent += ' *';
            }
            fieldContainer.appendChild(label);
            if (propertySchema.type === 'object' && propertySchema.properties) {
                const fieldset = document.createElement('fieldset');
                const legend = document.createElement('legend');
                legend.textContent = propertySchema.title || key;
                fieldset.appendChild(legend);
                buildFormFieldsRecursive(propertySchema, fieldset, currentDataPath, propertySchema.required || []);
                fieldContainer.appendChild(fieldset);
            } else if (propertySchema.type === 'array') {
                const arrayContainer = document.createElement('div');
                arrayContainer.classList.add('array-field-container');
                arrayContainer.dataset.dataPath = currentDataPath;
                arrayContainer.dataset.itemSchemaRef = propertySchema.items?.$ref;
                const itemSchema = propertySchema.items?.$ref ? getSchema(propertySchema.items.$ref) : propertySchema.items;
                const addButton = document.createElement('button');
                addButton.type = 'button';
                addButton.textContent = `Add ${propertySchema.title || key} Item`;
                addButton.classList.add('add-array-item-btn');
                addButton.addEventListener('click', () => addArrayItem(arrayContainer, itemSchema, currentDataPath));
                fieldContainer.appendChild(arrayContainer);
                fieldContainer.appendChild(addButton);
                setDataValueByPath(currentState, currentDataPath, []);
            } else {
                const inputElement = createFormFieldElement(key, propertySchema, currentDataPath, isRequired);
                if (inputElement) {
                    fieldContainer.appendChild(inputElement);
                }
            }
            parentElement.appendChild(fieldContainer);
        }
    }

    function addArrayItem(containerElement, itemSchema, basePath) {
        const arrayData = getDataValueByPath(currentState, basePath) || [];
        const itemIndex = arrayData.length;
        const itemDataPath = `${basePath}[${itemIndex}]`;
        const itemDiv = document.createElement('div');
        itemDiv.classList.add('array-item');
        itemDiv.dataset.itemIndex = itemIndex;
        itemDiv.style.border = "1px dashed #aaa";
        itemDiv.style.padding = "10px";
        itemDiv.style.marginBottom = "10px";
        const itemLegend = document.createElement('h4');
        const itemTitle = itemSchema.title || basePath.split('.').pop() || 'Item';
        itemLegend.textContent = `${itemTitle} ${itemIndex + 1}`;
        itemDiv.appendChild(itemLegend);
        let newItemData;
        if (itemSchema.type === "object") {
            newItemData = {};
        } else if (itemSchema.type === 'boolean') {
            newItemData = false;
        } else if (itemSchema.type === 'number' || itemSchema.type === 'integer') {
            newItemData = null;
        } else {
            newItemData = '';
        }
        arrayData.push(newItemData);
        if (itemSchema.type === "object" && itemSchema.properties) {
            buildFormFieldsRecursive(itemSchema, itemDiv, itemDataPath, itemSchema.required || []);
        } else {
            const inputElement = createFormFieldElement(`item_${itemIndex}`, itemSchema, itemDataPath, false);
            if (inputElement) itemDiv.appendChild(inputElement);
        }
        const removeButton = document.createElement('button');
        removeButton.type = 'button';
        removeButton.textContent = 'Remove Item';
        removeButton.classList.add('remove-array-item-btn');
        removeButton.addEventListener('click', () => {
            const currentArray = getDataValueByPath(currentState, basePath);
            const indexToRemove = parseInt(itemDiv.dataset.itemIndex, 10);
            if (currentArray && Array.isArray(currentArray) && indexToRemove < currentArray.length) {
                currentArray.splice(indexToRemove, 1);
            }
            containerElement.removeChild(itemDiv);
        });
        itemDiv.appendChild(removeButton);
        containerElement.appendChild(itemDiv);
    }

    function createFormFieldElement(key, propertySchema, dataPath, isRequired) {
        let inputElement;
        const id = dataPath.replace(/[.\[\]]/g, '_');
        const dataPathForListener = dataPath;
        if (propertySchema.enum) {
            inputElement = document.createElement('select');
            inputElement.id = id;
            const defaultOption = document.createElement('option');
            defaultOption.value = "";
            defaultOption.textContent = `-- Select ${propertySchema.title || key} --`;
            inputElement.appendChild(defaultOption);
            propertySchema.enum.forEach(enumValue => {
                const option = document.createElement('option');
                option.value = enumValue;
                option.textContent = enumValue;
                inputElement.appendChild(option);
            });
        } else {
            switch (propertySchema.type) {
                case 'string':
                    inputElement = document.createElement('input');
                    if (propertySchema.format === 'date-time') {
                        inputElement.type = 'datetime-local';
                    } else {
                        inputElement.type = 'text';
                        if (propertySchema.pattern) inputElement.pattern = propertySchema.pattern;
                    }
                    break;
                case 'integer':
                case 'number':
                    inputElement = document.createElement('input');
                    inputElement.type = 'number';
                    if (propertySchema.type === 'integer') inputElement.step = '1';
                    if (propertySchema.minimum !== undefined) inputElement.min = propertySchema.minimum;
                    if (propertySchema.maximum !== undefined) inputElement.max = propertySchema.maximum;
                    break;
                case 'boolean':
                    inputElement = document.createElement('input');
                    inputElement.type = 'checkbox';
                    break;
                default:
                    inputElement = document.createElement('input');
                    inputElement.type = 'text';
                    inputElement.placeholder = `Unsupported schema type: ${propertySchema.type}`;
                    console.warn(`Unsupported schema type: ${propertySchema.type} for key ${key}`);
            }
        }
        if (inputElement) {
            inputElement.id = id;
            inputElement.name = key;
            inputElement.dataset.dataPath = dataPathForListener;
            if (isRequired) {
                inputElement.required = true;
            }
            if (propertySchema.description && inputElement.type !== 'checkbox') {
                inputElement.title = propertySchema.description;
            }
            const existingValue = getDataValueByPath(currentState, dataPathForListener);
            if (existingValue !== undefined) {
                if (inputElement.type === 'checkbox') {
                    inputElement.checked = existingValue;
                } else {
                    inputElement.value = existingValue;
                }
            }
            inputElement.addEventListener('input', (e) => handleInputChange(e.target, dataPathForListener));
            inputElement.addEventListener('change', (e) => handleInputChange(e.target, dataPathForListener));
        }
        return inputElement;
    }

    function handleInputChange(targetElement, dataPath) {
        let value = targetElement.type === 'checkbox' ? targetElement.checked : targetElement.value;
        const propertySchemaPath = dataPath.replace(/^formBodyParams\./, '').split(/[.\[\]]+/).filter(Boolean);
        let schemaForField = currentState.selectedSrvSchema?.properties?.bodyParameters;
        if (schemaForField?.$ref) schemaForField = getSchema(schemaForField.$ref);
        for (let i = 0; i < propertySchemaPath.length; i++) {
            const part = propertySchemaPath[i];
            if (!schemaForField) break;
            if (schemaForField.properties && schemaForField.properties[part]) {
                schemaForField = schemaForField.properties[part];
            } else if (schemaForField.type === 'array' && schemaForField.items && !isNaN(parseInt(part))) {
                schemaForField = schemaForField.items.$ref ? getSchema(schemaForField.items.$ref) : schemaForField.items;
            } else {
                schemaForField = null;
                break;
            }
        }
        if (schemaForField && (schemaForField.type === 'integer' || schemaForField.type === 'number') && value !== '') {
            const numValue = Number(value);
            if (isNaN(numValue)) {
                value = targetElement.value;
                targetElement.classList.add('input-error');
            } else {
                value = numValue;
                targetElement.classList.remove('input-error');
            }
        } else {
            targetElement.classList.remove('input-error');
        }
        if (value === "" && targetElement.type !== 'checkbox' && !targetElement.required) {
            setDataValueByPath(currentState, dataPath, undefined);
        } else {
            setDataValueByPath(currentState, dataPath, value);
        }
    }

    function setDataValueByPath(obj, path, value) {
        const parts = path.split(/[.\[\]]+/).filter(Boolean);
        let current = obj;
        for (let i = 0; i < parts.length - 1; i++) {
            const part = parts[i];
            const nextPartIsArrayIndex = parts[i+1] && !isNaN(parseInt(parts[i+1]));
            if (!current[part] || typeof current[part] !== 'object') {
                current[part] = nextPartIsArrayIndex ? [] : {};
            }
            current = current[part];
        }
        const finalKey = parts[parts.length - 1];
        if (value === undefined) {
            if (Array.isArray(current) && !isNaN(parseInt(finalKey))) {
                current[parseInt(finalKey)] = undefined;
            } else {
                delete current[finalKey];
            }
        } else {
            current[finalKey] = value;
        }
    }

    function getDataValueByPath(obj, path) {
        const parts = path.split(/[.\[\]]+/).filter(Boolean);
        let current = obj;
        for (const part of parts) {
            if (current && typeof current === 'object' && part in current) {
                current = current[part];
            } else {
                return undefined;
            }
        }
        return current;
    }

    // --- Event Listeners ---
    function setupEventListeners() {
        environmentSelect.addEventListener('change', (e) => {
            currentState.selectedEnvironment = e.target.value ? JSON.parse(e.target.value) : null;
            resetDownstreamUI('environment');
            if (currentState.selectedEnvironment) {
                roleSelect.disabled = false;
                if (currentState.selectedRole) populateDuisVersions();
            }
        });
        roleSelect.addEventListener('change', (e) => {
            currentState.selectedRole = e.target.value ? JSON.parse(e.target.value) : null;
            resetDownstreamUI('role');
            if (currentState.selectedRole && currentState.selectedEnvironment) {
                duisVersionSelect.disabled = false;
                populateDuisVersions();
            }
        });
        duisVersionSelect.addEventListener('change', (e) => {
            currentState.selectedDuisVersion = e.target.value || null;
            resetDownstreamUI('duis');
            if (currentState.selectedDuisVersion) {
                displayOriginatorNameAndPopulateSrvs();
            }
        });
        srvSelect.addEventListener('change', handleSrvSelection);
        cvSelect.addEventListener('change', handleCvSelection);
        targetGuidInput.addEventListener('input', (e) => {
            if (currentState.selectedCv && currentState.selectedCv !== 8) {
                currentState.targetValue = e.target.value;
                generateJsonButton.disabled = !e.target.value.trim();
            }
        });
        executionDateTimeInput.addEventListener('input', (e) => {
            currentState.futureDateTimeValue = e.target.value;
            if (currentState.selectedSrvSchema?.properties?.bodyParameters?.properties?.executionDateTime ||
                currentState.selectedSrvSchema?.properties?.executionDateTime) {
                const pathInBody = 'formBodyParams.executionDateTime';
                if (getDataValueByPath(currentState, pathInBody) !== undefined ||
                    (currentState.selectedSrvSchema?.properties?.bodyParameters?.$ref &&
                     getSchema(currentState.selectedSrvSchema.properties.bodyParameters.$ref)?.properties?.executionDateTime)) {
                    setDataValueByPath(currentState, pathInBody, e.target.value);
                }
            }
        });
        generateJsonButton.addEventListener('click', generateOutputs);
        copyJsonButton.addEventListener('click', () => copyToClipboard(jsonOutput.textContent));
        copyCurlButton.addEventListener('click', () => copyToClipboard(curlOutput.textContent));
    }

    // --- Output Generation ---
    function generateOutputs() {
        if (!currentState.selectedEnvironment || !currentState.selectedRole || !currentState.selectedDuisVersion ||
            !currentState.determinedOriginatorName || !currentState.selectedSrvData || currentState.selectedCv === null) {
            alert("Please complete all top-level selections (Environment, Role, DUIS, SRV, CV).");
            return;
        }
        if (currentState.selectedCv !== 8 && (!currentState.targetValue || currentState.targetValue.trim() === '')) {
            alert("Target GUID is required for the selected Command Variant.");
            targetGuidInput.focus();
            return;
        }
        if (!currentState.targetValue) {
            alert("Target is not set. Please ensure CV selection is complete or GUID is entered.");
            return;
        }
        let srValue = currentState.selectedSrvData.srv_code;
        const srvParts = currentState.selectedSrvData.srv_code.split('.');
        if (srvParts.length === 3) {
            srValue = `${srvParts[0]}.${srvParts[1]}`;
        }
        const jsonData = {
            duisVersion: currentState.selectedDuisVersion,
            header: {
                originatorName: currentState.determinedOriginatorName,
                target: currentState.targetValue,
                sr: srValue,
                srv: currentState.selectedSrvData.srv_code,
                cv: currentState.selectedCv
            }
        };
        if (currentState.selectedSrvData.supports_future_date &&
            currentState.futureDateTimeValue &&
            currentState.futureDateTimeValue.trim() !== "") {
            const executionDate = new Date(currentState.futureDateTimeValue);
            const now = new Date();
            if (executionDate <= now) {
                alert("Execution Date/Time must be in the future.");
                executionDateTimeInput.focus();
                return;
            }
            const isoDateTime = executionDate.toISOString();
            if (currentState.selectedSrvSchema?.properties?.executionDateTime) {
                jsonData.executionDateTime = isoDateTime;
            }
        }
        const clonedFormBodyParams = JSON.parse(JSON.stringify(currentState.formBodyParams));
        const cleanedFormBodyParams = pruneEmptyObjects(clonedFormBodyParams);
        if (currentState.selectedSrvSchema?.properties?.bodyParameters) {
            if (cleanedFormBodyParams && Object.keys(cleanedFormBodyParams).length > 0) {
                jsonData.bodyParameters = cleanedFormBodyParams;
            } else {
                const bodyParamsPropSchema = currentState.selectedSrvSchema.properties.bodyParameters;
                const actualBodySchema = bodyParamsPropSchema.$ref ? getSchema(bodyParamsPropSchema.$ref) : bodyParamsPropSchema;
                if (actualBodySchema && (actualBodySchema.type !== 'object' || Object.keys(actualBodySchema.properties || {}).length > 0 || actualBodySchema.additionalProperties === true)) {
                    jsonData.bodyParameters = {};
                }
            }
        } else if (cleanedFormBodyParams && Object.keys(cleanedFormBodyParams).length > 0) {
            jsonData.bodyParameters = cleanedFormBodyParams;
        }
        jsonOutput.textContent = JSON.stringify(jsonData, null, 2);
        const curlCommand = `curl -X 'POST' \\\n` +
                            `  'http://localhost:${currentState.selectedEnvironment.port}/v1/request-executor/srv/${currentState.selectedSrvData.srv_code}' \\\n` +
                            `  -H 'accept: application/json' \\\n` +
                            `  -H 'Content-Type: application/json' \\\n` +
                            `  -d '${JSON.stringify(jsonData)}'`;
        curlOutput.textContent = curlCommand;
    }

    function pruneEmptyObjects(obj) {
        if (typeof obj !== 'object' || obj === null) {
            return (obj === "" || obj === null) ? undefined : obj;
        }
        if (Array.isArray(obj)) {
            const newArray = obj.map(pruneEmptyObjects).filter(item => item !== undefined);
            return newArray.length > 0 ? newArray : undefined;
        }
        const newObj = {};
        let isEmpty = true;
        for (const key in obj) {
            if (obj.hasOwnProperty(key)) {
                const value = pruneEmptyObjects(obj[key]);
                if (value !== undefined) {
                    newObj[key] = value;
                    isEmpty = false;
                }
            }
        }
        return isEmpty ? undefined : newObj;
    }

    function copyToClipboard(text) {
        navigator.clipboard.writeText(text).then(() => {
            alert('Copied to clipboard!');
        }).catch(err => {
            console.error('Failed to copy: ', err);
            alert('Failed to copy. See console.');
        });
    }

    loadConfigurations();
});
