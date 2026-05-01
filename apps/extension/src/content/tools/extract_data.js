function extractData(target, schema = null) {
  try {
    const targetElement = target
      ? document.querySelector(target)
      : document.querySelector('table, ul, ol, [role="table"], [data-list], .list, .items');
    if (!targetElement) {
      return { error: target ? `Target not found: ${target}` : 'No structured data target found on the page' };
    }

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

          // Check if cell contains a link
          const cellLink = cell.querySelector('a[href]');
          if (cellLink) {
            rowData[normalizeDataKey(header)] = {
              text: ContentSanitizer.sanitizeText(cellLink.innerText || cell.innerText || ''),
              href: cellLink.href
            };
          } else {
            rowData[normalizeDataKey(header)] = ContentSanitizer.sanitizeText(cell.innerText || '');
          }
        });

        // Also extract all links in the row as actions
        const rowLinks = row.querySelectorAll('a[href]');
        if (rowLinks.length > 0) {
          rowData._actions = Array.from(rowLinks).map(link => ({
            text: ContentSanitizer.sanitizeText(link.innerText.trim() || link.getAttribute('aria-label') || 'Link'),
            href: link.href
          }));
        }

        data.push(rowData);
      });
    } else {
      const items = targetElement.querySelectorAll('li, .item, [data-item]');
      const includeHtml = schema && schema.includeHtml === true;

      items.forEach(item => {
        const entry = { text: ContentSanitizer.sanitizeText(item.innerText || '') };

        // Always extract links/actions within each item
        const links = item.querySelectorAll('a[href]');
        if (links.length > 0) {
          entry.actions = Array.from(links).map(link => ({
            text: ContentSanitizer.sanitizeText(link.innerText.trim() || link.getAttribute('aria-label') || 'Link'),
            href: link.href
          }));
        }

        // Extract buttons within each item
        const buttons = item.querySelectorAll('button, [role="button"]');
        if (buttons.length > 0) {
          entry.buttons = Array.from(buttons).map(btn => ({
            text: ContentSanitizer.sanitizeText(btn.innerText.trim() || btn.getAttribute('aria-label') || 'Button'),
            selector: generateSelector(btn)
          }));
        }

        if (includeHtml) {
          entry.html = ContentSanitizer.sanitizeHTML(item.innerHTML || '');
        }

        data.push(entry);
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
