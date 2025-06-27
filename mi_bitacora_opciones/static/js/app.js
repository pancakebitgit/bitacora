document.addEventListener('DOMContentLoaded', () => {
    const API_BASE_URL = '/api'; // Adjusted to relative path

    const tabsContainer = document.getElementById('tabs-container');
    const operationsList = document.getElementById('operations-list');
    const newOperationBtn = document.getElementById('new-operation-btn');
    const operationModal = document.getElementById('operation-modal');
    const closeModalBtn = operationModal.querySelector('.close-button');
    const cancelModalBtn = document.getElementById('cancel-modal-btn');
    const operationForm = document.getElementById('operation-form');
    const legsInputArea = document.getElementById('legs-input-area');
    const addLegBtn = document.getElementById('add-leg-btn');

    let allOperations = {}; // To store fetched operations, grouped by expiration
    let activeTabVencimiento = null;
    let legCounter = 0;

    // --- UTILITY FUNCTIONS ---
    function formatDateForDisplay(dateString) {
        if (!dateString) return "N/A";
        const date = new Date(dateString);
        return date.toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' });
    }

    function formatDateForInput(dateString) {
        if (!dateString) return '';
        // Assuming dateString is in ISO format like "2023-11-15T10:30:00.000Z"
        const date = new Date(dateString);
        // Format to "YYYY-MM-DDTHH:mm"
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        const hours = String(date.getHours()).padStart(2, '0');
        const minutes = String(date.getMinutes()).padStart(2, '0');
        return `${year}-${month}-${day}T${hours}:${minutes}`;
    }


    // --- RENDER FUNCTIONS ---
    function renderTabs() {
        tabsContainer.innerHTML = ''; // Clear existing tabs
        const vencimientos = Object.keys(allOperations).sort(); // Sort dates

        if (vencimientos.length === 0) {
            tabsContainer.innerHTML = '<p>No hay operaciones registradas.</p>';
            return;
        }

        // Add "Todas" tab
        const allTabButton = document.createElement('button');
        allTabButton.classList.add('tab-button');
        allTabButton.textContent = 'Todas';
        allTabButton.dataset.vencimiento = 'TODAS';
        if (activeTabVencimiento === 'TODAS' || activeTabVencimiento === null && vencimientos.length > 0) {
            allTabButton.classList.add('active');
            if (activeTabVencimiento === null) activeTabVencimiento = 'TODAS';
        }
        allTabButton.addEventListener('click', () => setActiveTab('TODAS'));
        tabsContainer.appendChild(allTabButton);


        vencimientos.forEach(vencimiento => {
            const tabButton = document.createElement('button');
            tabButton.classList.add('tab-button');
            tabButton.textContent = formatDateForDisplay(vencimiento);
            tabButton.dataset.vencimiento = vencimiento;
            if (vencimiento === activeTabVencimiento) {
                tabButton.classList.add('active');
            }
            tabButton.addEventListener('click', () => setActiveTab(vencimiento));
            tabsContainer.appendChild(tabButton);
        });

        if (!activeTabVencimiento && vencimientos.length > 0) {
            setActiveTab('TODAS'); // Default to "TODAS" if no active tab or first load
        } else if (vencimientos.length > 0 && !vencimientos.includes(activeTabVencimiento) && activeTabVencimiento !== 'TODAS') {
             setActiveTab('TODAS'); // If active tab no longer exists, default to "TODAS"
        } else if (vencimientos.length === 0) {
            activeTabVencimiento = null; // No operations, no active tab
            renderOperations(); // Clear operations list
        }
    }

    function renderOperations() {
        operationsList.innerHTML = ''; // Clear existing operations
        let operationsToDisplay = [];

        if (activeTabVencimiento === 'TODAS') {
            Object.values(allOperations).forEach(group => operationsToDisplay.push(...group));
        } else if (activeTabVencimiento && allOperations[activeTabVencimiento]) {
            operationsToDisplay = allOperations[activeTabVencimiento];
        }

        if (operationsToDisplay.length === 0 && activeTabVencimiento) {
            operationsList.innerHTML = `<p>No hay operaciones para la fecha de vencimiento seleccionada.</p>`;
            return;
        } else if (operationsToDisplay.length === 0 && !activeTabVencimiento && Object.keys(allOperations).length > 0) {
             // This case might occur if "Todas" is selected but allOperations is empty after a delete
            operationsList.innerHTML = `<p>No hay operaciones registradas.</p>`;
            return;
        }


        operationsToDisplay.sort((a, b) => new Date(b.fecha_entrada) - new Date(a.fecha_entrada)); // Sort by entry date, newest first

        operationsToDisplay.forEach(op => {
            const card = document.createElement('div');
            card.classList.add('operation-card');
            card.dataset.id = op.id;

            let imagesHTML = '';
            if (op.imagenes && op.imagenes.length > 0) {
                op.imagenes.forEach(img => {
                    // Path is already correct from backend e.g. uploads/filename.jpg
                    imagesHTML += `<img src="/${img.path_archivo}" alt="Imagen de la operación ${op.id}">`;
                });
            }

            let legsHTML = '';
            if (op.legs && op.legs.length > 0) {
                op.legs.forEach(leg => {
                    legsHTML += `<div class="leg-item">${leg.accion} ${leg.cantidad} ${leg.tipo} @ ${leg.strike} (Vto: ${formatDateForDisplay(leg.vencimiento)}) Prima: ${leg.prima.toFixed(2)}</div>`;
                });
            }

            card.innerHTML = `
                <div class="card-header">
                    <h2>${op.subyacente} - ${op.estrategia_detectada}</h2>
                    <p>Entrada: ${formatDateForDisplay(op.fecha_entrada)}</p>
                </div>
                <div class="card-details">
                    <p><strong>Justificación:</strong> ${op.justificacion || 'N/A'}</p>
                    <div class="legs-container">
                        <h4>Legs:</h4>
                        ${legsHTML || '<p>No hay legs detallados.</p>'}
                    </div>
                    <div class="images-container">
                        <h4>Imágenes:</h4>
                        ${imagesHTML || '<p>No hay imágenes adjuntas.</p>'}
                    </div>
                    <button class="delete-button" data-id="${op.id}">Eliminar Operación</button>
                </div>
            `;
            operationsList.appendChild(card);
            card.classList.add('entering'); // For animation
            setTimeout(() => card.classList.remove('entering'), 500);
        });
    }

    function setActiveTab(vencimiento) {
        activeTabVencimiento = vencimiento;
        renderTabs(); // Re-render tabs to update active state
        renderOperations(); // Re-render operations for the new active tab
    }

    // --- API CALLS ---
    async function fetchOperations() {
        try {
            const response = await fetch(`${API_BASE_URL}/operaciones`);
            if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
            allOperations = await response.json();

            if (Object.keys(allOperations).length > 0 && !activeTabVencimiento) {
                activeTabVencimiento = 'TODAS'; // Default to "TODAS" if operations exist
            } else if (Object.keys(allOperations).length === 0) {
                activeTabVencimiento = null; // No operations, no active tab
            }

            renderTabs();
            renderOperations();
        } catch (error) {
            console.error("Error fetching operations:", error);
            operationsList.innerHTML = "<p>Error al cargar las operaciones. Intente más tarde.</p>";
        }
    }

    async function saveOperation(formData) {
        try {
            const response = await fetch(`${API_BASE_URL}/operaciones`, {
                method: 'POST',
                body: formData // FormData handles multipart/form-data for files
            });
            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
            }
            const newOperation = await response.json();

            // Add to local store and re-render
            const vencimientoGrupo = newOperation.legs.length > 0 ?
                                   new Date(newOperation.legs[0].vencimiento).toISOString().split('T')[0]
                                   : "N/A"; // This should match backend grouping logic

            if (!allOperations[vencimientoGrupo]) {
                allOperations[vencimientoGrupo] = [];
            }
            allOperations[vencimientoGrupo].push(newOperation);

            // If the new operation's group matches the active tab, or if "TODAS" is active
            if (activeTabVencimiento === vencimientoGrupo || activeTabVencimiento === 'TODAS') {
                 renderOperations(); // Optimized re-render
            }
            if (!Object.keys(allOperations).includes(vencimientoGrupo)){ // New vencimiento group
                renderTabs(); // Re-render tabs if a new group was added
            }


            closeOperationModal();
        } catch (error) {
            console.error("Error saving operation:", error);
            alert(`Error al guardar: ${error.message}`);
        }
    }

    async function deleteOperation(id) {
        if (!confirm("¿Está seguro de que desea eliminar esta operación?")) return;

        try {
            const response = await fetch(`${API_BASE_URL}/operaciones/${id}`, {
                method: 'DELETE',
            });
            if (!response.ok) {
                 const errorData = await response.json();
                throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
            }

            // Remove from local store and re-render
            let deletedFromGroup = null;
            for (const grupo in allOperations) {
                const index = allOperations[grupo].findIndex(op => op.id === id);
                if (index > -1) {
                    allOperations[grupo].splice(index, 1);
                    if (allOperations[grupo].length === 0) {
                        delete allOperations[grupo];
                        deletedFromGroup = grupo; // Mark that this group is now empty
                    }
                    break;
                }
            }

            // Handle UI update based on active tab
            if (deletedFromGroup === activeTabVencimiento) { // If the active tab's group was deleted
                activeTabVencimiento = 'TODAS'; // Switch to "TODAS"
                renderTabs(); // Tabs changed
                renderOperations(); // Operations for "TODAS"
            } else if (deletedFromGroup) { // A group was deleted, but not the active one
                 renderTabs(); // Tabs changed
                 renderOperations(); // Re-render current view (if it's "TODAS" it will reflect change)
            } else { // Operation deleted from a group that still exists, or from "TODAS" view
                renderOperations(); // Just re-render current view
            }
             if(Object.keys(allOperations).length === 0) { // If all operations are gone
                activeTabVencimiento = null;
                renderTabs();
                renderOperations();
            }


        } catch (error) {
            console.error("Error deleting operation:", error);
            alert(`Error al eliminar: ${error.message}`);
        }
    }


    // --- MODAL HANDLING ---
    function openOperationModal() {
        legCounter = 0;
        legsInputArea.innerHTML = ''; // Clear previous legs
        addLegToForm(); // Add the first leg by default
        operationForm.reset();
        // Set default entry date to now
        document.getElementById('fecha_entrada').value = formatDateForInput(new Date().toISOString());
        operationModal.style.display = 'block';
    }

    function closeOperationModal() {
        operationModal.style.display = 'none';
        operationForm.reset();
        legsInputArea.innerHTML = '';
        legCounter = 0;
    }

    function addLegToForm() {
        legCounter++;
        const legGroup = document.createElement('div');
        legGroup.classList.add('leg-input-group');
        legGroup.dataset.legId = legCounter;

        legGroup.innerHTML = `
            <h4>Leg ${legCounter}</h4>
            <div class="form-row">
                <div class="form-group">
                    <label for="leg_accion_${legCounter}">Acción:</label>
                    <select id="leg_accion_${legCounter}" name="leg_accion_${legCounter}" required>
                        <option value="COMPRA">COMPRA</option>
                        <option value="VENTA">VENTA</option>
                    </select>
                </div>
                <div class="form-group">
                    <label for="leg_tipo_${legCounter}">Tipo:</label>
                    <select id="leg_tipo_${legCounter}" name="leg_tipo_${legCounter}" required>
                        <option value="CALL">CALL</option>
                        <option value="PUT">PUT</option>
                    </select>
                </div>
            </div>
            <div class="form-row">
                <div class="form-group">
                    <label for="leg_cantidad_${legCounter}">Cantidad:</label>
                    <input type="number" id="leg_cantidad_${legCounter}" name="leg_cantidad_${legCounter}" min="1" value="1" required>
                </div>
                <div class="form-group">
                    <label for="leg_vencimiento_${legCounter}">Vencimiento:</label>
                    <input type="date" id="leg_vencimiento_${legCounter}" name="leg_vencimiento_${legCounter}" required>
                </div>
            </div>
            <div class="form-row">
                <div class="form-group">
                    <label for="leg_strike_${legCounter}">Strike:</label>
                    <input type="number" step="0.01" id="leg_strike_${legCounter}" name="leg_strike_${legCounter}" required>
                </div>
                <div class="form-group">
                    <label for="leg_prima_${legCounter}">Prima:</label>
                    <input type="number" step="0.01" id="leg_prima_${legCounter}" name="leg_prima_${legCounter}" required>
                </div>
            </div>
            ${legCounter > 1 ? '<button type="button" class="remove-leg-btn">Quitar Leg</button>' : ''}
        `;
        legsInputArea.appendChild(legGroup);

        if (legCounter > 1) {
            legGroup.querySelector('.remove-leg-btn').addEventListener('click', () => {
                legGroup.remove();
                // Renumber remaining legs visually if needed, though not strictly necessary for submission
            });
        }
    }


    // --- EVENT LISTENERS ---
    newOperationBtn.addEventListener('click', openOperationModal);
    closeModalBtn.addEventListener('click', closeOperationModal);
    cancelModalBtn.addEventListener('click', closeOperationModal);
    window.addEventListener('click', (event) => {
        if (event.target === operationModal) {
            closeOperationModal();
        }
    });

    addLegBtn.addEventListener('click', addLegToForm);

    operationForm.addEventListener('submit', (event) => {
        event.preventDefault();

        const subyacente = document.getElementById('subyacente').value;
        const fecha_entrada_val = document.getElementById('fecha_entrada').value;
        // Convert local datetime-local string to ISO string UTC for backend
        const fecha_entrada_date = new Date(fecha_entrada_val);
        const fecha_entrada_iso = fecha_entrada_date.toISOString();

        const justificacion = document.getElementById('justificacion').value;
        const imagenesInput = document.getElementById('imagenes');

        const legs = [];
        const legGroups = legsInputArea.querySelectorAll('.leg-input-group');
        legGroups.forEach(group => {
            const id = group.dataset.legId;
            legs.push({
                accion: group.querySelector(`select[name="leg_accion_${id}"]`).value,
                tipo: group.querySelector(`select[name="leg_tipo_${id}"]`).value,
                cantidad: parseInt(group.querySelector(`input[name="leg_cantidad_${id}"]`).value),
                vencimiento: group.querySelector(`input[name="leg_vencimiento_${id}"]`).value, // YYYY-MM-DD
                strike: parseFloat(group.querySelector(`input[name="leg_strike_${id}"]`).value),
                prima: parseFloat(group.querySelector(`input[name="leg_prima_${id}"]`).value),
            });
        });

        if (legs.length === 0) {
            alert("Debe añadir al menos un leg a la operación.");
            return;
        }

        const operationData = {
            subyacente,
            fecha_entrada: fecha_entrada_iso,
            justificacion,
            legs
        };

        const formData = new FormData();
        formData.append('data', JSON.stringify(operationData));

        if (imagenesInput.files.length > 0) {
            for (let i = 0; i < imagenesInput.files.length; i++) {
                formData.append('imagenes', imagenesInput.files[i]);
            }
        }
        saveOperation(formData);
    });

    operationsList.addEventListener('click', (event) => {
        // Card expansion/collapse
        const cardHeader = event.target.closest('.card-header');
        if (cardHeader) {
            const card = cardHeader.closest('.operation-card');
            const details = card.querySelector('.card-details');
            details.classList.toggle('expanded');
             // Toggle padding and max-height via class for CSS transitions
            if (details.classList.contains('expanded')) {
                details.style.maxHeight = details.scrollHeight + "px";
                details.style.paddingTop = "1.5rem";
                details.style.paddingBottom = "1.5rem";
            } else {
                details.style.maxHeight = "0";
                details.style.paddingTop = "0";
                details.style.paddingBottom = "0";

            }
            return; // Prevent further actions if header is clicked
        }

        // Delete button
        if (event.target.classList.contains('delete-button')) {
            const operationId = parseInt(event.target.dataset.id);
            deleteOperation(operationId);
        }
    });


    // --- INITIALIZATION ---
    fetchOperations();
});
