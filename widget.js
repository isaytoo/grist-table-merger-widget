/**
 * Grist Table Merger Widget
 * Copyright 2026 Said Hamadou (isaytoo)
 * Licensed under the Apache License, Version 2.0
 * https://github.com/isaytoo/grist-table-merger-widget
 */

// ══════════════════════════════════════════════════════════════
// APP STATE
// ══════════════════════════════════════════════════════════════
const APP = {
  tables: [],
  table1Columns: [],
  table2Columns: [],
  table1Data: [],
  table2Data: [],
  selectedColumns: new Set(),
  gristReady: false,
};

// ══════════════════════════════════════════════════════════════
// DOM ELEMENTS
// ══════════════════════════════════════════════════════════════
const $ = id => document.getElementById(id);
const table1Select = $('table1');
const table2Select = $('table2');
const linkColumnSelect = $('linkColumn');
const columnsPreview = $('columnsPreview');
const previewCard = $('previewCard');
const actionsCard = $('actionsCard');
const newTableNameInput = $('newTableName');
const btnMerge = $('btnMerge');
const btnReset = $('btnReset');
const progressSection = $('progressSection');
const progressFill = $('progressFill');
const progressText = $('progressText');
const statusMessage = $('statusMessage');

// ══════════════════════════════════════════════════════════════
// GRIST INITIALIZATION
// ══════════════════════════════════════════════════════════════
async function initGrist() {
  try {
    grist.ready({ requiredAccess: 'full' });
    APP.gristReady = true;
    
    // Load available tables
    const tables = await grist.docApi.listTables();
    APP.tables = tables.filter(t => !t.startsWith('_grist_') && !t.startsWith('GristHidden'));
    
    populateTableSelects();
  } catch (e) {
    console.error('Error initializing Grist:', e);
    showStatus('Erreur de connexion à Grist', 'error');
  }
}

function populateTableSelects() {
  const options = APP.tables.map(t => `<option value="${t}">${t}</option>`).join('');
  table1Select.innerHTML = '<option value="">-- Choisir une table --</option>' + options;
  table2Select.innerHTML = '<option value="">-- Choisir une table --</option>' + options;
}

// ══════════════════════════════════════════════════════════════
// FETCH TABLE METADATA (columns with types and formulas)
// ══════════════════════════════════════════════════════════════
async function fetchTableColumns(tableName) {
  try {
    // Fetch the _grist_Tables_column table to get column metadata
    const tablesData = await grist.docApi.fetchTable('_grist_Tables');
    const tableId = tablesData.id[tablesData.tableId.indexOf(tableName)];
    
    const columnsData = await grist.docApi.fetchTable('_grist_Tables_column');
    
    const columns = [];
    for (let i = 0; i < columnsData.id.length; i++) {
      if (columnsData.parentId[i] === tableId) {
        const colId = columnsData.colId[i];
        // Skip internal columns
        if (colId.startsWith('gristHelper_') || colId === 'manualSort') continue;
        
        columns.push({
          id: columnsData.id[i],
          colId: colId,
          type: columnsData.type[i],
          isFormula: columnsData.isFormula[i],
          formula: columnsData.formula[i] || '',
          label: columnsData.label[i] || colId,
        });
      }
    }
    
    return columns;
  } catch (e) {
    console.error('Error fetching columns:', e);
    return [];
  }
}

async function fetchTableData(tableName) {
  try {
    return await grist.docApi.fetchTable(tableName);
  } catch (e) {
    console.error('Error fetching table data:', e);
    return {};
  }
}

// ══════════════════════════════════════════════════════════════
// UI UPDATES
// ══════════════════════════════════════════════════════════════
async function onTable1Change() {
  const tableName = table1Select.value;
  if (!tableName) {
    APP.table1Columns = [];
    updateLinkColumnOptions();
    return;
  }
  
  APP.table1Columns = await fetchTableColumns(tableName);
  APP.table1Data = await fetchTableData(tableName);
  updateLinkColumnOptions();
  checkReadyForPreview();
}

async function onTable2Change() {
  const tableName = table2Select.value;
  if (!tableName) {
    APP.table2Columns = [];
    updateLinkColumnOptions();
    return;
  }
  
  APP.table2Columns = await fetchTableColumns(tableName);
  APP.table2Data = await fetchTableData(tableName);
  updateLinkColumnOptions();
  checkReadyForPreview();
}

function updateLinkColumnOptions() {
  // Find common column names between both tables
  const cols1 = new Set(APP.table1Columns.map(c => c.colId));
  const cols2 = new Set(APP.table2Columns.map(c => c.colId));
  
  // Also add Reference columns from table1 that point to table2
  const refCols = APP.table1Columns.filter(c => {
    const refMatch = c.type.match(/^Ref:(.+)$/);
    return refMatch && refMatch[1] === table2Select.value;
  });
  
  let options = '<option value="">-- Choisir la colonne de liaison --</option>';
  
  // Common columns
  const common = [...cols1].filter(c => cols2.has(c));
  if (common.length > 0) {
    options += '<optgroup label="Colonnes communes">';
    common.forEach(c => {
      options += `<option value="common:${c}">${c} (commune)</option>`;
    });
    options += '</optgroup>';
  }
  
  // Reference columns
  if (refCols.length > 0) {
    options += '<optgroup label="Colonnes de référence">';
    refCols.forEach(c => {
      options += `<option value="ref:${c.colId}">${c.colId} → ${table2Select.value}</option>`;
    });
    options += '</optgroup>';
  }
  
  linkColumnSelect.innerHTML = options;
}

function checkReadyForPreview() {
  if (table1Select.value && table2Select.value && linkColumnSelect.value) {
    showColumnsPreview();
  } else {
    previewCard.style.display = 'none';
    actionsCard.style.display = 'none';
  }
}

function showColumnsPreview() {
  previewCard.style.display = 'block';
  actionsCard.style.display = 'block';
  
  // Clear previous selections
  APP.selectedColumns.clear();
  
  // Generate default table name
  newTableNameInput.value = `${table1Select.value}_${table2Select.value}_Merged`;
  
  // Build columns list
  let html = '';
  
  // Table 1 columns
  APP.table1Columns.forEach(col => {
    if (col.colId === 'id') return; // Skip id column
    
    const typeClass = col.isFormula ? 'formula' : '';
    APP.selectedColumns.add(`1:${col.colId}`);
    
    html += `
      <div class="column-item">
        <input type="checkbox" checked data-source="1" data-col="${col.colId}" onchange="toggleColumn(this)">
        <span class="column-name">${col.label || col.colId}</span>
        <span class="column-type ${typeClass}">${col.isFormula ? 'Formule' : col.type}</span>
        <span class="column-source ugp">${table1Select.value}</span>
        ${col.isFormula ? `<span class="toggle-formula" onclick="toggleFormula(this)">voir</span>` : ''}
      </div>
      ${col.isFormula ? `<div class="formula-preview hidden">${escapeHtml(col.formula)}</div>` : ''}
    `;
  });
  
  // Table 2 columns (excluding link column and id)
  const linkCol = linkColumnSelect.value.split(':')[1];
  APP.table2Columns.forEach(col => {
    if (col.colId === 'id') return; // Skip id column
    
    // Check if column already exists in table 1 (by colId)
    const existsInTable1 = APP.table1Columns.some(c => c.colId === col.colId);
    if (existsInTable1) return; // Skip duplicates
    
    const typeClass = col.isFormula ? 'formula' : '';
    APP.selectedColumns.add(`2:${col.colId}`);
    
    html += `
      <div class="column-item">
        <input type="checkbox" checked data-source="2" data-col="${col.colId}" onchange="toggleColumn(this)">
        <span class="column-name">${col.label || col.colId}</span>
        <span class="column-type ${typeClass}">${col.isFormula ? 'Formule' : col.type}</span>
        <span class="column-source compta">${table2Select.value}</span>
        ${col.isFormula ? `<span class="toggle-formula" onclick="toggleFormula(this)">voir</span>` : ''}
      </div>
      ${col.isFormula ? `<div class="formula-preview hidden">${escapeHtml(col.formula)}</div>` : ''}
    `;
  });
  
  columnsPreview.innerHTML = html;
  
  console.log('Table 1 columns:', APP.table1Columns.map(c => c.colId));
  console.log('Table 2 columns:', APP.table2Columns.map(c => c.colId));
  console.log('Selected columns:', [...APP.selectedColumns]);
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text || '';
  return div.innerHTML;
}

function toggleColumn(checkbox) {
  const key = `${checkbox.dataset.source}:${checkbox.dataset.col}`;
  if (checkbox.checked) {
    APP.selectedColumns.add(key);
  } else {
    APP.selectedColumns.delete(key);
  }
}

function toggleFormula(el) {
  const preview = el.closest('.column-item').nextElementSibling;
  if (preview && preview.classList.contains('formula-preview')) {
    preview.classList.toggle('hidden');
    el.textContent = preview.classList.contains('hidden') ? 'voir' : 'masquer';
  }
}

function showStatus(message, type = 'info') {
  statusMessage.innerHTML = `<div class="status ${type}">${message}</div>`;
}

function updateProgress(percent, text) {
  progressSection.classList.remove('hidden');
  progressFill.style.width = `${percent}%`;
  progressText.textContent = text;
}

// ══════════════════════════════════════════════════════════════
// MERGE LOGIC
// ══════════════════════════════════════════════════════════════
async function mergeTables() {
  const newTableName = newTableNameInput.value.trim().replace(/[^a-zA-Z0-9_]/g, '_');
  if (!newTableName) {
    showStatus('Veuillez entrer un nom pour la nouvelle table', 'error');
    return;
  }
  
  btnMerge.disabled = true;
  
  try {
    updateProgress(5, 'Analyse des colonnes...');
    
    // Build column definitions for new table
    const columns = [];
    const formulaColumns = [];
    const dataColumns = [];
    
    // Get link column info
    const [linkType, linkCol] = linkColumnSelect.value.split(':');
    
    console.log('Link type:', linkType, 'Link col:', linkCol);
    console.log('Selected columns:', [...APP.selectedColumns]);
    
    // Process selected columns from table 1
    for (const col of APP.table1Columns) {
      const key = `1:${col.colId}`;
      if (!APP.selectedColumns.has(key)) continue;
      if (col.colId === 'id') continue;
      
      // Clean up type - remove Ref: prefix for non-reference columns in merged table
      let colType = col.type;
      if (colType.startsWith('Ref:') || colType.startsWith('RefList:')) {
        colType = 'Int'; // Convert references to Int (row IDs)
      }
      
      if (col.isFormula) {
        formulaColumns.push({
          colId: col.colId,
          label: col.label,
          type: col.type,
          formula: col.formula,
          source: 1,
        });
      } else {
        dataColumns.push({
          colId: col.colId,
          label: col.label,
          type: colType,
          source: 1,
        });
        columns.push({
          id: col.colId,
          fields: { type: colType === 'Any' ? 'Text' : colType, label: col.label || col.colId }
        });
      }
    }
    
    // Process selected columns from table 2
    for (const col of APP.table2Columns) {
      const key = `2:${col.colId}`;
      if (!APP.selectedColumns.has(key)) continue;
      if (col.colId === 'id') continue;
      
      // Skip if already added from table 1
      if (dataColumns.some(c => c.colId === col.colId) || formulaColumns.some(c => c.colId === col.colId)) continue;
      
      // Clean up type
      let colType = col.type;
      if (colType.startsWith('Ref:') || colType.startsWith('RefList:')) {
        colType = 'Int';
      }
      
      if (col.isFormula) {
        formulaColumns.push({
          colId: col.colId,
          label: col.label,
          type: col.type,
          formula: col.formula,
          source: 2,
        });
      } else {
        dataColumns.push({
          colId: col.colId,
          label: col.label,
          type: colType,
          source: 2,
        });
        columns.push({
          id: col.colId,
          fields: { type: colType === 'Any' ? 'Text' : colType, label: col.label || col.colId }
        });
      }
    }
    
    console.log('Data columns:', dataColumns.map(c => c.colId));
    console.log('Formula columns:', formulaColumns.map(c => c.colId));
    
    updateProgress(15, 'Création de la nouvelle table...');
    
    // Create the new table
    await grist.docApi.applyUserActions([
      ['AddTable', newTableName, columns]
    ]);
    
    updateProgress(25, 'Préparation des données...');
    
    // Build merged data
    const table1Name = table1Select.value;
    const table2Name = table2Select.value;
    
    // Create lookup map for table 2 data (keyed by row ID)
    const table2Map = new Map();
    if (APP.table2Data.id) {
      for (let i = 0; i < APP.table2Data.id.length; i++) {
        const rowId = APP.table2Data.id[i];
        const rowData = {};
        for (const colId of Object.keys(APP.table2Data)) {
          rowData[colId] = APP.table2Data[colId][i];
        }
        table2Map.set(rowId, rowData);
      }
      console.log('Table 2 map size:', table2Map.size);
      console.log('Table 2 map keys (row IDs):', [...table2Map.keys()]);
      if (table2Map.size > 0) {
        console.log('Sample table 2 row:', table2Map.get([...table2Map.keys()][0]));
      }
    }
    
    // Build merged records
    const mergedRecords = [];
    const rowCount = APP.table1Data.id ? APP.table1Data.id.length : 0;
    
    console.log('Table 1 data keys:', Object.keys(APP.table1Data));
    console.log('Table 2 data keys:', Object.keys(APP.table2Data));
    console.log('Row count:', rowCount);
    
    for (let i = 0; i < rowCount; i++) {
      const record = {};
      
      // Get data from table 1
      for (const col of dataColumns.filter(c => c.source === 1)) {
        const value = APP.table1Data[col.colId] ? APP.table1Data[col.colId][i] : null;
        record[col.colId] = value;
      }
      
      // Get linked table 2 row
      let table2Row = null;
      if (linkType === 'ref') {
        const refId = APP.table1Data[linkCol] ? APP.table1Data[linkCol][i] : null;
        console.log(`Row ${i}: linkCol=${linkCol}, refId=${refId}`);
        if (refId) {
          table2Row = table2Map.get(refId);
          if (!table2Row) {
            console.log(`  No match found in table2Map for refId=${refId}`);
          }
        }
      } else if (linkType === 'common') {
        const linkValue = APP.table1Data[linkCol] ? APP.table1Data[linkCol][i] : null;
        // Find matching row in table 2
        for (const [id, row] of table2Map) {
          if (row[linkCol] === linkValue) {
            table2Row = row;
            break;
          }
        }
      }
      
      // Get data from table 2
      if (table2Row) {
        for (const col of dataColumns.filter(c => c.source === 2)) {
          const value = table2Row[col.colId] !== undefined ? table2Row[col.colId] : null;
          record[col.colId] = value;
        }
      } else {
        // Set null for table 2 columns if no match
        for (const col of dataColumns.filter(c => c.source === 2)) {
          record[col.colId] = null;
        }
      }
      
      mergedRecords.push(record);
    }
    
    console.log('First merged record:', mergedRecords[0]);
    
    updateProgress(50, 'Insertion des données...');
    
    // Insert data in batches
    const batchSize = 100;
    const colIds = dataColumns.map(c => c.colId);
    
    for (let i = 0; i < mergedRecords.length; i += batchSize) {
      const batch = mergedRecords.slice(i, i + batchSize);
      const progress = 50 + Math.round((i / mergedRecords.length) * 30);
      updateProgress(progress, `Insertion des données (${i + batch.length}/${mergedRecords.length})...`);
      
      await grist.docApi.applyUserActions([
        ['BulkAddRecord', newTableName, batch.map(() => null), {
          ...Object.fromEntries(colIds.map(col => [col, batch.map(r => r[col])]))
        }]
      ]);
    }
    
    updateProgress(85, 'Création des formules...');
    
    // Add formula columns
    for (let i = 0; i < formulaColumns.length; i++) {
      const col = formulaColumns[i];
      const progress = 85 + Math.round((i / formulaColumns.length) * 10);
      updateProgress(progress, `Création de la formule ${col.colId}...`);
      
      // Adapt formula: replace references to old tables with rec.
      let formula = col.formula;
      
      // Simple adaptation: replace $column with rec.column for self-references
      // More complex adaptations may be needed for lookups
      
      try {
        await grist.docApi.applyUserActions([
          ['AddColumn', newTableName, col.colId, {
            type: col.type === 'Any' ? 'Any' : col.type,
            isFormula: true,
            formula: formula,
          }]
        ]);
      } catch (e) {
        console.warn(`Could not create formula column ${col.colId}:`, e);
        // Create as empty formula column
        await grist.docApi.applyUserActions([
          ['AddColumn', newTableName, col.colId, {
            type: 'Any',
            isFormula: true,
            formula: `# TODO: Adapter cette formule\n# Original: ${formula}\nNone`,
          }]
        ]);
      }
    }
    
    updateProgress(100, 'Fusion terminée !');
    
    showStatus(`
      <strong>✓ Fusion réussie !</strong><br>
      Table créée : <strong>${newTableName}</strong><br>
      ${mergedRecords.length} enregistrements fusionnés<br>
      ${dataColumns.length} colonnes de données + ${formulaColumns.length} formules
    `, 'success');
    
    btnMerge.disabled = false;
    
  } catch (e) {
    console.error('Merge error:', e);
    showStatus(`Erreur lors de la fusion : ${e.message}`, 'error');
    btnMerge.disabled = false;
  }
}

function resetForm() {
  table1Select.value = '';
  table2Select.value = '';
  linkColumnSelect.innerHTML = '<option value="">-- Choisir la colonne de liaison --</option>';
  previewCard.style.display = 'none';
  actionsCard.style.display = 'none';
  statusMessage.innerHTML = '';
  progressSection.classList.add('hidden');
  APP.table1Columns = [];
  APP.table2Columns = [];
  APP.table1Data = [];
  APP.table2Data = [];
  APP.selectedColumns.clear();
}

// ══════════════════════════════════════════════════════════════
// EVENT LISTENERS
// ══════════════════════════════════════════════════════════════
table1Select.addEventListener('change', onTable1Change);
table2Select.addEventListener('change', onTable2Change);
linkColumnSelect.addEventListener('change', checkReadyForPreview);
btnMerge.addEventListener('click', mergeTables);
btnReset.addEventListener('click', resetForm);

// ══════════════════════════════════════════════════════════════
// INIT
// ══════════════════════════════════════════════════════════════
initGrist();
