function extractData(target, schema = null) {
  try {
    const targetElement = target
      ? document.querySelector(target)
      : document.querySelector('table, ul, ol, [role="table"], [data-list], .list, .items');
    if (!targetElement) {
      return { error: target ? `Target not found: ${target}` : 'No structured data target found on the page' };
    }

    // Extract table or list data
    const data = [];

    if (targetElement.tagName === 'TABLE') {
      const headers = Array.from(
        targetElement.querySelectorAll('thead th, thead td')
      ).map(cell => cell.innerText.trim());

      const rows = targetElement.querySelectorAll('tbody tr');
      rows.forEach(row => {
        const cells = row.querySelectorAll('td');
        const rowData = {};
        cells.forEach((cell, idx) => {
          const header = headers[idx] || `col_${idx}`;
          rowData[normalizeDataKey(header)] = cell.innerText.trim();
        });
        data.push(rowData);
      });
    } else {
      // Extract list items
      const items = targetElement.querySelectorAll('li, .item, [data-item]');
      items.forEach(item => {
        data.push({
          text: item.innerText,
          html: item.innerHTML
        });
      });
    }

    return {
      success: true,
      data,
      count: data.length,
      target: generateSelector(targetElement),
      timestamp: Date.now()
    };

  } catch (error) {
    return { error: error.message };
  }
}

function normalizeDataKey(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'value';
}