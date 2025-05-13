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
        selectedCv: null,
        futureDateTimeValue: null,
        targetValue: null,
        formBodyParams: {} // For SRV specific fields later
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

            config.app = await appRes.json();
            const originatorCsvText = await originatorRes.text();
            config.originators = parseCSV(originatorCsvText);
            config.srvMatrix = await srvMatrixRes.json();
            config.openapiExecutor = await openapiRes.json();
            
            console.log("Configurations loaded:", config);
            initializeUI();
        } catch (error) {
            console.error("Error loading configurations:", error);
            alert("Failed to load configurations. Check console for details.");
        }
    }

    // --- UI Initialization and Population Logic ---
    function initializeUI() {
        populateEnvironments();
        populateRoles();
        setupEventListeners();
    }

    function populateEnvironments() {
        config.app.environments.forEach(env => {
            const option = document.createElement('option');
            option.value = env.name;
            option.textContent = env.name;
            environmentSelect.appendChild(option);
        });
    }

    function populateRoles() {
        config.app.roles.forEach(role => {
            const option = document.createElement('option');
            option.value = role.abbreviation; // Store abbreviation
            option.textContent = role.fullName;
            option.dataset.fullName = role.fullName; // Keep full name for display/logic if needed
            roleSelect.appendChild(option);
        });
    }

    function populateDuisVersions() {
        duisVersionSelect.innerHTML = '<option value="">-- Select DUIS Version --</option>'; // Clear previous
        originatorNameDisplay.textContent = "N/A";
        disableAndClear(srvSelect, "-- Select SRV --");
        disableAndClear(cvSelect, "-- Select CV --");
        hideSrvSpecifics();


        if (!currentState.selectedEnvironment || !currentState.selectedRole) return;

        const relevantOriginators = config.originators.filter(org =>
            org.Environment === currentState.selectedEnvironment.name &&
            org['User Role'] === currentState.selectedRole.abbreviation
        );
        
        const duisVersions = [...new Set(relevantOriginators.map(org => org['DUIS Version']))].sort();
        
        duisVersions.forEach(version => {
            const option = document.createElement('option');
            option.value = version;
            option.textContent = version;
            duisVersionSelect.appendChild(option);
        });
        duisVersionSelect.disabled = duisVersions.length === 0;
    }

    function displayOriginatorName() {
        originatorNameDisplay.textContent = "N/A";
        disableAndClear(srvSelect, "-- Select SRV --");
        disableAndClear(cvSelect, "-- Select CV --");
        hideSrvSpecifics();

        if (!currentState.selectedEnvironment || !currentState.selectedRole || !currentState.selectedDuisVersion) return;

        const foundOriginator = config.originators.find(org =>
            org.Environment === currentState.selectedEnvironment.name &&
            org['User Role'] === currentState.selectedRole.abbreviation &&
            org['DUIS Version'] === currentState.selectedDuisVersion
        );

        if (foundOriginator) {
            currentState.determinedOriginatorName = foundOriginator.originatorName; // Use the correct column name
            originatorNameDisplay.textContent = currentState.determinedOriginatorName;
            populateSrvs();
        } else {
            currentState.determinedOriginatorName = null;
            originatorNameDisplay.textContent = "No Originator found for selection.";
        }
    }

    function populateSrvs() {
        srvSelect.innerHTML = '<option value="">-- Select SRV --</option>';
        disableAndClear(cvSelect, "-- Select CV --");
        hideSrvSpecifics();


        if (!currentState.selectedRole) return;

        // Handle IS/GS mapping (IS covers IS1/IS2, GS covers GS1/GS2)
        const roleAbbrev = currentState.selectedRole.abbreviation;
        let matrixRoleFilter = roleAbbrev;
        if (roleAbbrev.startsWith("IS")) matrixRoleFilter = "IS";
        if (roleAbbrev.startsWith("GS")) matrixRoleFilter = "GS";

        const eligibleSrvs = config.srvMatrix.filter(srv => 
            srv.eligible_user_roles.includes(matrixRoleFilter)
            // Add DUIS version filtering later if "Adaptor Validates by DUIS Version" is 'Yes'
        ).sort((a,b) => { // Numerical sort for SRV codes
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
        cvSelect.innerHTML = '<option value="">-- Select CV --</option>';
        hideSrvSpecifics();


        if (!currentState.selectedSrvData) return;

        currentState.selectedSrvData.command_variants.forEach(cv => {
            const option = document.createElement('option');
            option.value = cv;
            option.textContent = cv;
            cvSelect.appendChild(option);
        });
        cvSelect.disabled = false;
        
        // Show future date input if applicable
        futureDateContainer.style.display = currentState.selectedSrvData.supports_future_date ? 'block' : 'none';
        
        // Placeholder for dynamic form generation
        srvSpecificForm.innerHTML = `<p>Form for SRV ${currentState.selectedSrvData.srv_code} (${currentState.selectedSrvData.srv_name}) would be built here based on OpenAPI schema.</p>`;
        // TODO: Implement dynamic form generation from config.openapiExecutor
    }
    
    function handleTargetField() {
        targetGuidContainer.style.display = 'none';
        targetCv8DisplayContainer.style.display = 'none';
        currentState.targetValue = null;

        if (!currentState.selectedCv || !currentState.selectedEnvironment) return;

        if (currentState.selectedCv === "8" || Number(currentState.selectedCv) === 8) {
            currentState.targetValue = currentState.selectedEnvironment.target_eui64_cv8;
            targetCv8Display.textContent = currentState.targetValue;
            targetCv8DisplayContainer.style.display = 'block';
        } else {
            targetGuidInput.value = ''; // Clear previous
            targetGuidContainer.style.display = 'block';
        }
        generateJsonButton.disabled = false; // Enable generate button once CV is selected
    }

    function hideSrvSpecifics() {
        futureDateContainer.style.display = 'none';
        targetGuidContainer.style.display = 'none';
        targetCv8DisplayContainer.style.display = 'none';
        srvSpecificForm.innerHTML = '<p>SRV specific fields will appear here.</p>';
        generateJsonButton.disabled = true;
    }

    function disableAndClear(selectElement, defaultOptionText) {
        selectElement.disabled = true;
        selectElement.innerHTML = `<option value="">${defaultOptionText}</option>`;
    }


    // --- Event Listeners ---
    function setupEventListeners() {
        environmentSelect.addEventListener('change', (e) => {
            const selectedEnvName = e.target.value;
            currentState.selectedEnvironment = config.app.environments.find(env => env.name === selectedEnvName) || null;
            roleSelect.disabled = !currentState.selectedEnvironment;
            populateDuisVersions(); // Re-filter DUIS if role was already selected
        });

        roleSelect.addEventListener('change', (e) => {
            const selectedRoleAbbrev = e.target.value;
            currentState.selectedRole = config.app.roles.find(r => r.abbreviation === selectedRoleAbbrev) || null;
            duisVersionSelect.disabled = !currentState.selectedRole;
            populateDuisVersions();
        });

        duisVersionSelect.addEventListener('change', (e) => {
            currentState.selectedDuisVersion = e.target.value || null;
            srvSelect.disabled = !currentState.selectedDuisVersion;
            displayOriginatorName(); // This will also trigger populateSrvs if originator is found
        });

        srvSelect.addEventListener('change', (e) => {
            const srvCode = e.target.value;
            currentState.selectedSrvData = config.srvMatrix.find(srv => srv.srv_code === srvCode) || null;
            cvSelect.disabled = !currentState.selectedSrvData;
            populateCvSelect();
        });
        
        cvSelect.addEventListener('change', (e) => {
            currentState.selectedCv = e.target.value || null;
            handleTargetField();
        });

        targetGuidInput.addEventListener('input', (e) => {
            if (currentState.selectedCv && currentState.selectedCv !== "8") {
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
            alert("Please complete all selections.");
            return;
        }

        // --- SR / SRV Logic ---
        let srValue = currentState.selectedSrvData.srv_code;
        if (currentState.selectedSrvData.srv_code.split('.').length === 3) {
            srValue = currentState.selectedSrvData.srv_code.substring(0, currentState.selectedSrvData.srv_code.lastIndexOf('.'));
        }

        // --- Basic JSON Structure ---
        const jsonData = {
            duisVersion: currentState.selectedDuisVersion,
            header: {
                originatorName: currentState.determinedOriginatorName,
                target: currentState.targetValue,
                sr: srValue,
                srv: currentState.selectedSrvData.srv_code,
                cv: parseInt(currentState.selectedCv, 10) // Ensure CV is a number
                // originatorCounter, transformCv, etc. could be added if needed
            },
            bodyParameters: {
                // TODO: This needs to be populated from the dynamically generated form
                // For now, a placeholder or based on a very simple SRV
            }
        };
        
        // Add executionDateTime if applicable and provided
        if (currentState.selectedSrvData.supports_future_date && currentState.futureDateTimeValue) {
            // Determine placement based on OpenAPI schema for the SRV (this is simplified)
            // For a real app, you'd check the specific SRV DTO schema
            // Example: some SRVs might have it top-level, some in bodyParameters
            const srvDtoSchemaPath = config.openapiExecutor.paths[`/v1/request-executor/srv/${currentState.selectedSrvData.srv_code}`]?.post?.requestBody?.content['application/json']?.schema?.$ref;
            if (srvDtoSchemaPath) {
                const schemaName = srvDtoSchemaPath.split('/').pop();
                const srvDtoSchema = config.openapiExecutor.components.schemas[schemaName];
                if (srvDtoSchema && srvDtoSchema.properties && srvDtoSchema.properties.executionDateTime) {
                     jsonData.executionDateTime = currentState.futureDateTimeValue;
                } else if (srvDtoSchema && srvDtoSchema.properties && srvDtoSchema.properties.bodyParameters) {
                    // Check if executionDateTime is inside bodyParameters schema
                    const bodyParamsSchemaName = srvDtoSchema.properties.bodyParameters.$ref.split('/').pop();
                    const bodyParamsSchema = config.openapiExecutor.components.schemas[bodyParamsSchemaName];
                    if (bodyParamsSchema && bodyParamsSchema.properties && bodyParamsSchema.properties.executionDateTime) {
                         jsonData.bodyParameters.executionDateTime = currentState.futureDateTimeValue;
                    } else { // Default to top-level if not clearly in bodyParameters via schema
                        jsonData.executionDateTime = currentState.futureDateTimeValue;
                    }
                } else {
                     jsonData.executionDateTime = currentState.futureDateTimeValue; // Fallback
                }
            } else {
                jsonData.executionDateTime = currentState.futureDateTimeValue; // Fallback if schema path not found
            }
        }


        // Placeholder for SRV 1.5 body for demonstration
        if (currentState.selectedSrvData.srv_code === "1.5") {
            jsonData.bodyParameters = {
                "creditMode" : { // or "prepaymentMode" depending on schema for 1.5
                  "resetMeterBalance" : true // Example value
                }
            };
        }
        // Add more specific body structures for other SRVs if you hardcode them for now


        jsonOutput.textContent = JSON.stringify(jsonData, null, 2);

        // --- Curl Command ---
        const curlCommand = `curl -X 'POST' \\
  'http://localhost:${currentState.selectedEnvironment.port}/v1/request-executor/srv/${currentState.selectedSrvData.srv_code}' \\
  -H 'accept: application/json' \\
  -H 'Content-Type: application/json' \\
  -d '${JSON.stringify(jsonData)}'`;
        curlOutput.textContent = curlCommand;
    }

    function copyToClipboard(text) {
        navigator.clipboard.writeText(text).then(() => {
            alert('Copied to clipboard!');
        }).catch(err => {
            console.error('Failed to copy: ', err);
            alert('Failed to copy. See console.');
        });
    }

    // --- Initial Load ---
    loadConfigurations();
});