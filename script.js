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
        console.log("Attempting to load configurations...");
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
            
            console.log("All config files fetched successfully.");

            config.app = await appRes.json();
            console.log("app-config.json parsed:", config.app);

            const originatorCsvText = await originatorRes.text();
            config.originators = parseCSV(originatorCsvText);
            console.log("OriginatorNameList.csv parsed. Entries:", config.originators.length);
            
            config.srvMatrix = await srvMatrixRes.json();
            console.log("srv-matrix-config.json parsed. Entries:", config.srvMatrix.length);
            
            config.openapiExecutor = await openapiRes.json();
            console.log("openapi-adaptor-request-executor.json parsed.");
            
            initializeUI();
        } catch (error) {
            console.error("Error loading configurations:", error);
            alert(`Failed to load configurations. Check console. Error: ${error.message}`);
        }
    }

    // --- UI Initialization and Population Logic ---
    function initializeUI() {
        console.log("Initializing UI...");
        populateEnvironments();
        populateRoles();
        setupEventListeners();
    }

    function populateEnvironments() {
        console.log("Populating environments dropdown...");
        if (config && config.app && config.app.environments && Array.isArray(config.app.environments)) {
            config.app.environments.forEach(env => {
                if (env && typeof env.name === 'string') {
                    const option = document.createElement('option');
                    option.value = JSON.stringify(env); // Store whole object
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
            option.value = JSON.stringify(role); // Store whole object
            option.textContent = role.fullName;
            roleSelect.appendChild(option);
        });
    }

    function populateDuisVersions() {
        duisVersionSelect.innerHTML = '<option value="">-- Select DUIS Version --</option>';
        resetDownstreamUI('duis');

        if (!currentState.selectedEnvironment || !currentState.selectedRole) return;

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

    function displayOriginatorName() {
        resetDownstreamUI('originator');
        if (!currentState.selectedEnvironment || !currentState.selectedRole || !currentState.selectedDuisVersion) return;

        const foundOriginator = config.originators.find(org =>
            org.Environment === currentState.selectedEnvironment.name &&
            org['User Role'] === currentState.selectedRole.abbreviation &&
            org['DUIS Version'] === currentState.selectedDuisVersion
        );

        if (foundOriginator && foundOriginator.originatorName) {
            currentState.determinedOriginatorName = foundOriginator.originatorName;
            originatorNameDisplay.textContent = currentState.determinedOriginatorName;
            populateSrvs();
        } else {
            originatorNameDisplay.textContent = "No Originator found for selection.";
        }
    }

    function populateSrvs() {
        resetDownstreamUI('srv');
        if (!currentState.selectedRole) return;

        const roleAbbrev = currentState.selectedRole.abbreviation;
        let matrixRoleFilter = roleAbbrev;
        if (roleAbbrev.startsWith("IS")) matrixRoleFilter = "IS";
        if (roleAbbrev.startsWith("GS")) matrixRoleFilter = "GS";

        const eligibleSrvs = config.srvMatrix.filter(srv => 
            srv.eligible_user_roles.includes(matrixRoleFilter)
        ).sort((a,b) => {
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

    function populateCvSelect() {
        resetDownstreamUI('cv');
        if (!currentState.selectedSrvData) return;

        currentState.selectedSrvData.command_variants.forEach(cv => {
            const option = document.createElement('option');
            option.value = cv;
            option.textContent = cv;
            cvSelect.appendChild(option);
        });
        cvSelect.disabled = currentState.selectedSrvData.command_variants.length === 0;
        
        futureDateContainer.style.display = currentState.selectedSrvData.supports_future_date ? 'block' : 'none';
        if (!currentState.selectedSrvData.supports_future_date) {
            executionDateTimeInput.value = ''; // Clear it if not supported
            currentState.futureDateTimeValue = null;
        }
        
        generateDynamicSrvForm();
    }

    function handleTargetField() {
        targetGuidContainer.style.display = 'none';
        targetCv8DisplayContainer.style.display = 'none';
        targetGuidInput.value = '';
        targetCv8Display.textContent = 'N/A';
        currentState.targetValue = null;
        generateJsonButton.disabled = true; // Disable until target is potentially set

        if (!currentState.selectedCv || !currentState.selectedEnvironment) return;

        if (String(currentState.selectedCv) === "8") { // Ensure comparison as string or number consistently
            currentState.targetValue = currentState.selectedEnvironment.target_eui64_cv8;
            targetCv8Display.textContent = currentState.targetValue;
            targetCv8DisplayContainer.style.display = 'block';
            generateJsonButton.disabled = false; // Enable as target is auto-set
        } else {
            targetGuidContainer.style.display = 'block';
            // Button remains disabled until user types into GUID input if it's required
            // Or enable it and validate on generate. For now, enable if CV is not 8
            generateJsonButton.disabled = false;
        }
    }
    
    function resetDownstreamUI(fromStep) {
        switch(fromStep) {
            case 'environment':
                roleSelect.selectedIndex = 0;
                // fall-through
            case 'role':
                duisVersionSelect.innerHTML = '<option value="">-- Select DUIS Version --</option>';
                duisVersionSelect.disabled = true;
                currentState.selectedDuisVersion = null;
                 // fall-through
            case 'duis':
                originatorNameDisplay.textContent = "N/A";
                currentState.determinedOriginatorName = null;
                srvSelect.innerHTML = '<option value="">-- Select SRV --</option>';
                srvSelect.disabled = true;
                currentState.selectedSrvData = null;
                currentState.selectedSrvSchema = null;
                // fall-through
            case 'srv':
                cvSelect.innerHTML = '<option value="">-- Select CV --</option>';
                cvSelect.disabled = true;
                currentState.selectedCv = null;
                // fall-through
            case 'cv':
                srvSpecificForm.innerHTML = '<p>SRV specific fields will appear here.</p>';
                currentState.formBodyParams = {};
                futureDateContainer.style.display = 'none';
                executionDateTimeInput.value = '';
                currentState.futureDateTimeValue = null;
                targetGuidContainer.style.display = 'none';
                targetGuidInput.value = '';
                targetCv8DisplayContainer.style.display = 'none';
                targetCv8Display.textContent = 'N/A';
                currentState.targetValue = null;
                generateJsonButton.disabled = true;
                jsonOutput.textContent = '{}';
                curlOutput.textContent = 'curl ...';
                break;
        }
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
        currentState.formBodyParams = {}; 

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

        const bodyParamsProperty = srvDtoSchema.properties?.bodyParameters;
        if (!bodyParamsProperty) {
            srvSpecificForm.innerHTML = `<p>No 'bodyParameters' defined for this SRV. If this SRV has no body params, this is normal.</p>`;
            return; 
        }

        const bodyParamsSchemaRef = bodyParamsProperty.$ref;
        let bodyParamsSchema = bodyParamsProperty; 

        if (bodyParamsSchemaRef) {
            bodyParamsSchema = getSchema(bodyParamsSchemaRef);
        }
        
        if (!bodyParamsSchema) {
            srvSpecificForm.innerHTML = `<p>Error: Could not resolve bodyParameters schema. Ref: ${bodyParamsSchemaRef || 'inline'}</p>`;
            return;
        }
        
        if (bodyParamsSchema.type === 'object' && (!bodyParamsSchema.properties || Object.keys(bodyParamsSchema.properties).length === 0) && !bodyParamsSchema.additionalProperties) {
             srvSpecificForm.innerHTML = `<p>This SRV has an empty 'bodyParameters' object (no specific fields to fill).</p>`;
        } else {
            const formFragment = document.createDocumentFragment();
            buildFormFieldsRecursive(bodyParamsSchema, formFragment, 'formBodyParams');
            srvSpecificForm.appendChild(formFragment);
        }
    }

    function buildFormFieldsRecursive(schema, parentElement, parentDataPath, parentSchemaRequired = []) {
        if (!schema) return;

        // Handle non-object schemas directly (e.g. bodyParameters is a string or number directly)
        if (schema.type && schema.type !== 'object' && schema.type !== 'array') {
            const fieldName = parentDataPath.split('.').pop(); // Get the last part as field name
            const inputElement = createFormFieldElement(fieldName, schema, parentDataPath, parentSchemaRequired.includes(fieldName));
            if (inputElement) parentElement.appendChild(inputElement);
            return;
        }
        
        if (!schema.properties && schema.type === 'object' && !schema.additionalProperties) {
            // Empty object {} - render nothing specific or a placeholder
            // const p = document.createElement('p');
            // p.textContent = `(Empty object for ${parentDataPath.split('.').pop()})`;
            // parentElement.appendChild(p);
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
            label.htmlFor = currentDataPath; // IDs should be unique
            label.textContent = propertySchema.title || propertySchema.description || key;
            if (isRequired) {
                label.textContent += ' *';
            }
            fieldContainer.appendChild(label);

            if (propertySchema.type === 'object' && propertySchema.properties) {
                const fieldset = document.createElement('fieldset');
                const legend = document.createElement('legend');
                legend.textContent = propertySchema.title || key;
                // if (isRequired && Object.keys(propertySchema.properties).length > 0) legend.textContent += ' *'; // Indicate complex object is required
                fieldset.appendChild(legend);
                buildFormFieldsRecursive(propertySchema, fieldset, currentDataPath, propertySchema.required || []);
                fieldContainer.appendChild(fieldset);
            } else if (propertySchema.type === 'array') {
                const arrayContainer = document.createElement('div');
                arrayContainer.classList.add('array-field-container');
                arrayContainer.dataset.dataPath = currentDataPath;
                arrayContainer.dataset.itemSchemaRef = propertySchema.items?.$ref; // Store ref if items are complex

                const itemSchema = propertySchema.items?.$ref ? getSchema(propertySchema.items.$ref) : propertySchema.items;

                const addButton = document.createElement('button');
                addButton.type = 'button';
                addButton.textContent = `Add ${propertySchema.title || key} Item`;
                addButton.classList.add('add-array-item-btn');
                addButton.addEventListener('click', () => addArrayItem(arrayContainer, itemSchema, currentDataPath));
                
                fieldContainer.appendChild(arrayContainer); // Where items will be rendered
                fieldContainer.appendChild(addButton);

                // Initialize data structure for array
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
        itemDiv.style.border = "1px dashed #aaa";
        itemDiv.style.padding = "10px";
        itemDiv.style.marginBottom = "10px";


        const itemLegend = document.createElement('h4');
        itemLegend.textContent = `${basePath.split('.').pop()} Item ${itemIndex + 1}`;
        itemDiv.appendChild(itemLegend);


        if (itemSchema.type === "object" && itemSchema.properties) {
            // For object items, create a default empty object in the data
            setDataValueByPath(currentState, itemDataPath, {});
            buildFormFieldsRecursive(itemSchema, itemDiv, itemDataPath, itemSchema.required || []);
        } else { // Simple type array item (string, number, etc.)
             // For simple items, initialize with a default value or let input handle it
            setDataValueByPath(currentState, itemDataPath, itemSchema.type === 'boolean' ? false : (itemSchema.type === 'number' || itemSchema.type === 'integer' ? null : ''));
            const inputElement = createFormFieldElement(`item_${itemIndex}`, itemSchema, itemDataPath, false); // isRequired for array item itself is complex
            if (inputElement) itemDiv.appendChild(inputElement);
        }
        
        const removeButton = document.createElement('button');
        removeButton.type = 'button';
        removeButton.textContent = 'Remove Item';
        removeButton.classList.add('remove-array-item-btn');
        removeButton.addEventListener('click', () => {
            containerElement.removeChild(itemDiv);
            // Remove from data model - more complex, need to shift indices or use nulls
            const currentArray = getDataValueByPath(currentState, basePath);
            if (currentArray) {
                currentArray.splice(itemIndex, 1); // This might re-index, need careful data binding update if indices are used in paths elsewhere
                // Re-render or re-bind array items might be needed if indices are critical for data paths of other elements
                 console.log("Updated array data:", basePath, getDataValueByPath(currentState, basePath));
            }

        });
        itemDiv.appendChild(removeButton);
        containerElement.appendChild(itemDiv);

        // Ensure the array exists in formBodyParams
        let pathParts = basePath.split('.').slice(1);
        let currentObject = currentState.formBodyParams;
        pathParts.forEach((part, index) => {
            if (index === pathParts.length - 1) {
                if (!currentObject[part] || !Array.isArray(currentObject[part])) {
                    currentObject[part] = [];
                }
            } else {
                if (!currentObject[part] || typeof currentObject[part] !== 'object') {
                    currentObject[part] = {};
                }
                currentObject = currentObject[part];
            }
        });
        // Add new item placeholder to data
        const actualArray = getDataValueByPath(currentState, basePath);
        if (actualArray && itemSchema.type === "object") actualArray.push({});
        else if (actualArray) actualArray.push(null); // Placeholder for simple types
    }


    function createFormFieldElement(key, propertySchema, dataPath, isRequired) {
        let inputElement;
        const id = dataPath.replace(/[.\[\]]/g, '_'); // Make ID HTML-safe

        const dataPathForListener = dataPath; // Capture for listener

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
            inputElement.name = key; // Or a more unique name if needed
            inputElement.dataset.dataPath = dataPathForListener;
            if (isRequired) {
                inputElement.required = true;
            }
            if (propertySchema.description && inputElement.type !== 'checkbox') { // Tooltip for non-checkboxes
                inputElement.title = propertySchema.description;
            }


            inputElement.addEventListener('input', (e) => handleInputChange(e.target, dataPathForListener));
            inputElement.addEventListener('change', (e) => handleInputChange(e.target, dataPathForListener)); // For selects and checkboxes
        }
        return inputElement;
    }

    function handleInputChange(targetElement, dataPath) {
        let value = targetElement.type === 'checkbox' ? targetElement.checked : targetElement.value;
        
        // Type coercion for numbers
        if ((targetElement.type === 'number' || targetElement.inputMode === 'numeric') && value !== '') {
            value = Number(value);
            if (isNaN(value)) { // If conversion results in NaN, maybe keep string or handle error
                value = targetElement.value; 
            }
        }
        
        // Handle empty string for optional non-checkbox fields by deleting the key
        if (value === "" && targetElement.type !== 'checkbox' && !targetElement.required) {
            setDataValueByPath(currentState, dataPath, undefined); // 'undefined' will lead to key deletion by pruneEmptyObjects
        } else {
            setDataValueByPath(currentState, dataPath, value);
        }
        // console.log("Updated formBodyParams:", JSON.stringify(currentState.formBodyParams, null, 2));
    }

    function setDataValueByPath(obj, path, value) {
        const parts = path.split(/[.\[\]]+/).filter(Boolean); // 'formBodyParams.arr[0].name' -> ['formBodyParams', 'arr', '0', 'name']
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
                current.splice(parseInt(finalKey), 1); // Or set to null/undefined if preferred
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
            resetDownstreamUI('environment'); // Reset from role downwards
            if (currentState.selectedEnvironment) {
                roleSelect.disabled = false;
                 populateDuisVersions(); // Populate DUIS if role is already selected
            } else {
                roleSelect.disabled = true;
            }
        });

        roleSelect.addEventListener('change', (e) => {
            currentState.selectedRole = e.target.value ? JSON.parse(e.target.value) : null;
            resetDownstreamUI('role'); // Reset from DUIS downwards
            if (currentState.selectedRole) {
                duisVersionSelect.disabled = false;
                populateDuisVersions();
            } else {
                duisVersionSelect.disabled = true;
            }
        });

        duisVersionSelect.addEventListener('change', (e) => {
            currentState.selectedDuisVersion = e.target.value || null;
            resetDownstreamUI('duis'); // Reset from originator display downwards
            if (currentState.selectedDuisVersion) {
                srvSelect.disabled = false; // Enable SRV select for populating
                displayOriginatorName(); 
            } else {
                 srvSelect.disabled = true;
            }
        });

        srvSelect.addEventListener('change', (e) => {
            const srvCode = e.target.value;
            currentState.selectedSrvData = config.srvMatrix.find(srv => srv.srv_code === srvCode) || null;
            currentState.selectedSrvSchema = null;
            resetDownstreamUI('srv'); // Reset from CV downwards
            if (currentState.selectedSrvData) {
                cvSelect.disabled = false;
                populateCvSelect(); 
            } else {
                cvSelect.disabled = true;
            }
        });
        
        cvSelect.addEventListener('change', (e) => {
            currentState.selectedCv = e.target.value || null;
            resetDownstreamUI('cv'); // Reset target and generate button
            if(currentState.selectedCv) {
                 handleTargetField(); // This will enable generate button if target is resolved
            } else {
                 generateJsonButton.disabled = true;
            }
        });

        targetGuidInput.addEventListener('input', (e) => {
            if (currentState.selectedCv && String(currentState.selectedCv) !== "8") { // Ensure selectedCv is string for comparison
                currentState.targetValue = e.target.value;
            }
        });
        
        executionDateTimeInput.addEventListener('input', (e) => {
            currentState.futureDateTimeValue = e.target.value;
        });

        generateJsonButton.addEventListener('click', generateOutputs);
        copyJsonButton.addEventListener('click', () => copyToClipboard(jsonOutput.textContent));
        copyCurlButton.addEventListener('click', () => copyToClipboard(curlOutput.textContent));
    }

    // --- Output Generation ---
    function generateOutputs() {
        if (!currentState.selectedEnvironment || !currentState.selectedRole || !currentState.selectedDuisVersion || !currentState.determinedOriginatorName || !currentState.selectedSrvData || !currentState.selectedCv || !currentState.targetValue) {
            alert("Please complete all selections (Environment, Role, DUIS, SRV, CV, and Target if applicable).");
            return;
        }
         if (String(currentState.selectedCv) !== "8" && (!currentState.targetValue || currentState.targetValue.trim() === '')) {
            alert("Target GUID is required for the selected Command Variant.");
            targetGuidInput.focus();
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
                cv: parseInt(currentState.selectedCv, 10)
            }
            // bodyParameters will be added or not based on form data and schema
        };
        
        const cleanedFormBodyParams = pruneEmptyObjects(JSON.parse(JSON.stringify(currentState.formBodyParams)));

        if (cleanedFormBodyParams && Object.keys(cleanedFormBodyParams).length > 0) {
            jsonData.bodyParameters = cleanedFormBodyParams;
        } else if (currentState.selectedSrvSchema?.properties?.bodyParameters) {
            // If bodyParameters was defined in schema but is empty, represent it as an empty object
            // unless the schema for bodyParameters itself was truly an empty object definition
            const bodyParamsPropSchema = currentState.selectedSrvSchema.properties.bodyParameters;
            let bodyActualSchema = bodyParamsPropSchema.$ref ? getSchema(bodyParamsPropSchema.$ref) : bodyParamsPropSchema;
            if (!(bodyActualSchema && (bodyActualSchema.type !== 'object' || Object.keys(bodyActualSchema.properties || {}).length === 0 && !bodyActualSchema.additionalProperties))) {
                 jsonData.bodyParameters = {};
            }
            // if bodyParameters was an empty schema object and result is empty, it will be omitted, which is fine.
        }


        if (currentState.selectedSrvData.supports_future_date && currentState.futureDateTimeValue && currentState.futureDateTimeValue.trim() !== "") {
            const executionDate = new Date(currentState.futureDateTimeValue);
            const now = new Date();
            if (executionDate <= now) {
                alert("Execution Date/Time must be in the future.");
                executionDateTimeInput.focus(); 
                return; 
            }
            
            let dateTimePlacedInBody = false;
            // Check if executionDateTime should be in bodyParameters based on its schema
            if (jsonData.bodyParameters && jsonData.bodyParameters.hasOwnProperty('executionDateTime')) {
                // It was already included via formBodyParams because it's part of bodyParameters schema
                dateTimePlacedInBody = true;
            }

            // If not placed in body, and schema for SRV DTO has it top-level, place it there
            if (!dateTimePlacedInBody && currentState.selectedSrvSchema?.properties?.executionDateTime) {
                 jsonData.executionDateTime = currentState.futureDateTimeValue;
            } else if (!dateTimePlacedInBody && !currentState.selectedSrvSchema?.properties?.executionDateTime && currentState.selectedSrvData.supports_future_date) {
                // Fallback: if SRV supports it, and it's not in body and not top-level in DTO,
                // we might assume top-level if this scenario is valid.
                // For now, prefer explicit schema definition. If schema does not define it, it shouldn't be there.
                 console.warn(`executionDateTime supported by SRV Matrix but not found in SRV DTO schema (${currentState.selectedSrvData.srv_code}) at top-level or explicitly in bodyParameters schema. Omitting.`);
            }
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
            return (obj === "" || obj === null) ? undefined : obj; // Convert empty strings/nulls from simple inputs to undefined
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
