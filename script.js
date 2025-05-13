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
        selectedSrvSchema: null, // The main Srv_X_Y_Z_Dto schema for the selected SRV
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
            console.log("app-config.json parsed.");

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
        // currentState.selectedDuisVersion reset by upstream change

        if (!currentState.selectedEnvironment || !currentState.selectedRole) {
            duisVersionSelect.disabled = true;
            return;
        }

        const relevantOriginators = config.originators.filter(org =>
            org.Environment === currentState.selectedEnvironment.name &&
            org['User Role'] === currentState.selectedRole.abbreviation // Assuming 'User Role' is the CSV header for abbreviation
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
                org['User Role'] === currentState.selectedRole.abbreviation && // Assuming 'User Role' is the CSV header for abbreviation
                org['DUIS Version'] === currentState.selectedDuisVersion
            );

            if (foundOriginator && foundOriginator.originatorName) { // UPDATED based on clarification: CSV header for this is 'originatorName'
                currentState.determinedOriginatorName = foundOriginator.originatorName;
                originatorNameDisplay.textContent = currentState.determinedOriginatorName;
            } else {
                originatorNameDisplay.textContent = "No Originator found for selection.";
            }
        }
        populateSrvs(); // Populate/clear SRVs based on new originator status
    }

    function populateSrvs() {
        resetDownstreamUI('srv');
        srvSelect.innerHTML = '<option value="">-- Select SRV --</option>';

        if (!currentState.selectedRole || !currentState.determinedOriginatorName) {
            // If no originator, likely means DUIS is not selected for a role that needs it,
            // or the combo doesn't exist. No SRVs should be shown.
            srvSelect.disabled = true;
            return;
        }

        const roleAbbrev = currentState.selectedRole.abbreviation;
        let matrixRoleFilter = roleAbbrev;
        if (roleAbbrev.startsWith("IS")) matrixRoleFilter = "IS";
        if (roleAbbrev.startsWith("GS")) matrixRoleFilter = "GS";

        const eligibleSrvs = config.srvMatrix.filter(srv => {
            if (!srv.eligible_user_roles.includes(matrixRoleFilter)) {
                return false;
            }
            // Clarification #1: DUIS validation logic to be added later.
            // For now, if adaptor_validates_by_duis is true, it means we need a selectedDuisVersion.
            // The fact that determinedOriginatorName is set implies a DUIS was selected if one was needed for the originator.
            // if (srv.adaptor_validates_by_duis === true && !currentState.selectedDuisVersion) {
            //     return false;
            // }
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
            option.textContent = `${srv.srv_code} - ${srv.srv_name}`; // srv.srv_name from matrix
            srvSelect.appendChild(option);
        });
        srvSelect.disabled = eligibleSrvs.length === 0;
    }

    function handleSrvSelection() {
        const srvCode = srvSelect.value;
        currentState.selectedSrvData = config.srvMatrix.find(srv => srv.srv_code === srvCode) || null;
        currentState.selectedSrvSchema = null;

        resetDownstreamUI('srv'); // Clears CV, form, formBodyParams, target, outputs

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

        // Target and outputs are already cleared by resetDownstreamUI('srv') called in handleSrvSelection

        if (!currentState.selectedSrvData) {
            cvSelect.disabled = true;
            return;
        }

        currentState.selectedSrvData.command_variants.forEach(cv => {
            const option = document.createElement('option');
            option.value = cv; // Value is number
            option.textContent = cv;
            cvSelect.appendChild(option);
        });
        cvSelect.disabled = currentState.selectedSrvData.command_variants.length === 0;

        // Handle future date visibility based on SRV Matrix
        const shouldShowFutureDate = currentState.selectedSrvData.supports_future_date;
        futureDateContainer.style.display = shouldShowFutureDate ? 'block' : 'none';
        if (!shouldShowFutureDate) {
            executionDateTimeInput.value = '';
            currentState.futureDateTimeValue = null;
        } else {
            executionDateTimeInput.value = currentState.futureDateTimeValue || ''; // Retain if previously set
        }
        
        generateDynamicSrvForm();
    }

    function handleCvSelection() {
        currentState.selectedCv = cvSelect.value ? parseInt(cvSelect.value, 10) : null; // Store CV as number

        // Reset only target and outputs - bodyParameters form and data are NOT touched
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
            generateJsonButton.disabled = !currentState.targetValue; // Enable if target is auto-set
        } else {
            targetGuidContainer.style.display = 'block';
            // Restore previous non-CV8 target if user is tabbing around or re-selecting
            if (currentState.targetValue && currentState.targetValue !== currentState.selectedEnvironment.target_eui64_cv8) {
                targetGuidInput.value = currentState.targetValue;
            } else {
                targetGuidInput.value = ''; // Clear if previous was CV8 target or no target
                currentState.targetValue = ''; // Reset state if clearing input
            }
            targetCv8Display.textContent = 'N/A';
            generateJsonButton.disabled = !targetGuidInput.value.trim();
        }
    }
    
    function resetDownstreamUI(fromStep) {
        // ... (Keep the more granular reset logic from the previous full script I provided)
        // This was: if fromStep is 'srv', clear form and formBodyParams.
        // If fromStep is 'cv', DO NOT clear form or formBodyParams.
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
        if (toClear.includes('form')) { // This is critical
            srvSpecificForm.innerHTML = '<p>SRV specific fields will appear here.</p>';
            currentState.formBodyParams = {}; // Reset the data model for the form
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
    
        // Re-evaluate disabled states
        if (!currentState.selectedEnvironment) roleSelect.disabled = true;
        if (!currentState.selectedRole || !currentState.selectedEnvironment) duisVersionSelect.disabled = true;
        if (!currentState.determinedOriginatorName) srvSelect.disabled = true; // Originator needed for SRV list
        if (!currentState.selectedSrvData) cvSelect.disabled = true;
        if (!currentState.selectedCv || !currentState.targetValue) generateJsonButton.disabled = true;
        else if (String(currentState.selectedCv) !== "8" && !targetGuidInput.value.trim()) generateJsonButton.disabled = true;
        else generateJsonButton.disabled = false;


    }


    // --- Schema Resolver ---
    function getSchema(ref) {
        // ... (Keep existing getSchema - it's good)
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
        // currentState.formBodyParams is reset when SRV changes (via resetDownstreamUI('srv'))
        // It should NOT be reset here if we want to preserve data on mere re-renders (though not strictly needed now)

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
        currentState.selectedSrvSchema = srvDtoSchema; // Store the main DTO (e.g., Srv_1_5_Dto)

        const bodyParamsPropertySchema = srvDtoSchema.properties?.bodyParameters;
        
        // Check if executionDateTime is a top-level field in the Srv_X_Y_Z_Dto and needs a form field
        // This is separate from bodyParameters handling.
        const formFragment = document.createDocumentFragment();
        if (srvDtoSchema.properties?.executionDateTime && currentState.selectedSrvData.supports_future_date) {
            // This DTO has executionDateTime directly, not within bodyParameters.
            // The UI element for this is already #executionDateTime, handled by futureDateContainer visibility.
            // Ensure its data path is handled if not already:
            // For now, we assume `currentState.futureDateTimeValue` handles this top-level case if present.
        }


        if (!bodyParamsPropertySchema) {
            // No bodyParameters defined in the Srv_X_Y_Z_Dto schema.
            // If executionDateTime was also not top-level, then this SRV truly has no fillable body.
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
        // ... (Keep code from previous full script)
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
        // ... (Keep code from previous full script, with //TODO for removal)
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
                currentArray.splice(indexToRemove, 1); // TODO: This re-indexes. For robust UI, re-render all items in containerElement.
            }
            containerElement.removeChild(itemDiv); 
            console.log("Updated array after removal:", basePath, getDataValueByPath(currentState, basePath));
        });
        itemDiv.appendChild(removeButton);
        containerElement.appendChild(itemDiv);
    }


    function createFormFieldElement(key, propertySchema, dataPath, isRequired) {
        // ... (Keep code from previous full script)
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

            // Restore value from currentState.formBodyParams if it exists
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
        // ... (Keep code from previous full script)
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
                 if (i + 1 < propertySchemaPath.length && isNaN(parseInt(propertySchemaPath[i+1]))) {
                    // Property of an item
                 }
            } else {
                schemaForField = null; 
                break;
            }
        }
        
        if (schemaForField && (schemaForField.type === 'integer' || schemaForField.type === 'number') && value !== '') {
            const numValue = Number(value);
            if (isNaN(numValue)) {
                value = targetElement.value; 
                 console.warn(`Invalid number input for ${dataPath}: ${targetElement.value}`);
                 targetElement.classList.add('input-error'); 
            } else {
                 value = numValue; // Use the coerced number
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
        // ... (Keep existing - it's complex but functional for object paths)
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
        // ... (Keep existing)
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
                if (currentState.selectedRole) populateDuisVersions(); // Re-filter DUIS if role was already set
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
            // If executionDateTime is part of formBodyParams schema, update it there too
            // This specific input is for the top-level or primary future date concept
            if (currentState.selectedSrvSchema?.properties?.bodyParameters?.properties?.executionDateTime ||
                currentState.selectedSrvSchema?.properties?.executionDateTime) {
                // Logic to decide where this specific input's value should go
                // If defined in bodyParameters schema:
                const pathInBody = 'formBodyParams.executionDateTime'; // Example path
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
        // Basic validation
        if (!currentState.selectedEnvironment || !currentState.selectedRole || !currentState.selectedDuisVersion || 
            !currentState.determinedOriginatorName || !currentState.selectedSrvData || currentState.selectedCv === null) { // Check for null CV
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
                cv: currentState.selectedCv // Already an integer from handleCvSelection
            }
        };
        
        // Handle executionDateTime
        // It's included if:
        // 1. SRV Matrix says it's supported
        // 2. User has entered a value
        // 3. Value is a future date
        // Placement depends on the OpenAPI schema of the Srv_X_Y_Z_Dto
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

            // Check if the main SRV DTO schema (e.g., Srv_1_6_Dto) has 'executionDateTime' at the top level.
            if (currentState.selectedSrvSchema?.properties?.executionDateTime) {
                jsonData.executionDateTime = isoDateTime;
            } 
            // If not top-level, it's assumed to be handled within formBodyParams if defined in bodyParameters schema
            // (handleInputChange for a field named executionDateTime would have put it there).
            // No explicit addition here for bodyParameters.executionDateTime if futureDateTimeValue is for top-level.
        }
        
        // Prune and add bodyParameters from the dynamic form
        // JSON.parse(JSON.stringify()) for a deep clone before pruning
        const clonedFormBodyParams = JSON.parse(JSON.stringify(currentState.formBodyParams));
        const cleanedFormBodyParams = pruneEmptyObjects(clonedFormBodyParams);

        if (currentState.selectedSrvSchema?.properties?.bodyParameters) {
            if (cleanedFormBodyParams && Object.keys(cleanedFormBodyParams).length > 0) {
                jsonData.bodyParameters = cleanedFormBodyParams;
            } else {
                // If bodyParameters is an expected property, include it as {} even if empty,
                // unless its schema is truly an empty object definition itself.
                const bodyParamsPropSchema = currentState.selectedSrvSchema.properties.bodyParameters;
                const actualBodySchema = bodyParamsPropSchema.$ref ? getSchema(bodyParamsPropSchema.$ref) : bodyParamsPropSchema;
                if (actualBodySchema && (actualBodySchema.type !== 'object' || Object.keys(actualBodySchema.properties || {}).length > 0 || actualBodySchema.additionalProperties === true)) {
                    jsonData.bodyParameters = {};
                }
                // If actualBodySchema is just `type: "object"` with no properties and additionalProperties: false, then an empty jsonData.bodyParameters is correct if cleaned is undefined.
            }
        } else if (cleanedFormBodyParams && Object.keys(cleanedFormBodyParams).length > 0) {
            console.warn(`Collected bodyParameters for ${currentState.selectedSrvData.srv_code}, but 'bodyParameters' property not explicitly defined in its main DTO schema. Including them.`);
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
        // ... (Keep existing - it's mostly good)
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
