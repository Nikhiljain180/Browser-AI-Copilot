/**
 * Form Filler — handles ALL input types
 * Supports: text, email, password, number, tel, url, textarea,
 *           select, checkbox, radio, date, time, range, color, file (name only)
 */
function fillInput(target, value) {
  try {
    const element = resolveElement(target);
    if (!element) {
      return { error: `Input not found: ${target?.agentId || target?.selector || 'unknown target'}` };
    }

    element.focus();
    element.scrollIntoView({ behavior: 'smooth', block: 'center' });

    const tagName = element.tagName.toUpperCase();
    const inputType = (element.type || '').toLowerCase();

    let result;

    // ─────────────────────────────────────────────
    // 1️⃣ SELECT DROPDOWN
    // ─────────────────────────────────────────────
    if (tagName === 'SELECT') {
      result = fillSelect(element, value);
    }

    // ─────────────────────────────────────────────
    // 2️⃣ CHECKBOX
    // ─────────────────────────────────────────────
    else if (inputType === 'checkbox') {
      result = fillCheckbox(element, value);
    }

    // ─────────────────────────────────────────────
    // 3️⃣ RADIO BUTTON
    // ─────────────────────────────────────────────
    else if (inputType === 'radio') {
      result = fillRadio(element, value);
    }

    // ─────────────────────────────────────────────
    // 4️⃣ DATE / TIME / DATETIME-LOCAL / MONTH / WEEK
    // ─────────────────────────────────────────────
    else if (['date', 'time', 'datetime-local', 'month', 'week'].includes(inputType)) {
      result = fillDateTime(element, value, inputType);
    }

    // ─────────────────────────────────────────────
    // 5️⃣ RANGE (slider)
    // ─────────────────────────────────────────────
    else if (inputType === 'range') {
      result = fillRange(element, value);
    }

    // ─────────────────────────────────────────────
    // 6️⃣ COLOR PICKER
    // ─────────────────────────────────────────────
    else if (inputType === 'color') {
      result = fillColor(element, value);
    }

    // ─────────────────────────────────────────────
    // 7️⃣ FILE INPUT (limited — can't set actual file)
    // ─────────────────────────────────────────────
    else if (inputType === 'file') {
      result = { error: 'File inputs cannot be programmatically filled for security reasons' };
    }

    // ─────────────────────────────────────────────
    // 8️⃣ TEXTAREA
    // ─────────────────────────────────────────────
    else if (tagName === 'TEXTAREA') {
      result = fillTextInput(element, value);
    }

    // ─────────────────────────────────────────────
    // 9️⃣ TEXT-LIKE INPUTS (text, email, password, number, tel, url, search)
    // ─────────────────────────────────────────────
    else if (tagName === 'INPUT') {
      result = fillTextInput(element, value);
    }

    // ─────────────────────────────────────────────
    // 🔟 CONTENTEDITABLE (rich text editors)
    // ─────────────────────────────────────────────
    else if (element.isContentEditable || element.contentEditable === 'true') {
      result = fillContentEditable(element, value);
    }

    // ─────────────────────────────────────────────
    // ❓ UNKNOWN — try as text
    // ─────────────────────────────────────────────
    else {
      result = fillTextInput(element, value);
    }

    // Fire all events to ensure frameworks pick up the change
    fireAllEvents(element);

    return result;

  } catch (error) {
    return { error: error.message };
  }
}


// ═══════════════════════════════════════════════════
// INDIVIDUAL FILL HANDLERS
// ═══════════════════════════════════════════════════

/**
 * TEXT / EMAIL / PASSWORD / NUMBER / TEL / URL / TEXTAREA
 */
function fillTextInput(element, value) {
  // Clear existing value
  element.value = '';
  
  // Use native setter to bypass React/Vue/Angular controlled components
  setNativeValue(element, String(value));

  return {
    success: true,
    message: `✓ Filled ${element.type || 'text'} with: "${value}"`
  };
}


/**
 * SELECT DROPDOWN — smart multi-level matching
 */
function fillSelect(selectElement, value) {
  const options = Array.from(selectElement.options);
  const searchVal = String(value).toLowerCase().trim();

  let match = null;

  // Level 1: Exact match on value attribute
  match = options.find(opt => opt.value.toLowerCase() === searchVal);

  // Level 2: Exact match on visible text
  if (!match) {
    match = options.find(opt => opt.textContent.toLowerCase().trim() === searchVal);
  }

  // Level 3: Option text contains search value
  if (!match) {
    match = options.find(opt => opt.textContent.toLowerCase().includes(searchVal));
  }

  // Level 4: Search value contains option value/text
  if (!match) {
    match = options.find(opt => {
      if (!opt.value) return false;
      const optVal = opt.value.toLowerCase();
      const optText = opt.textContent.toLowerCase().trim();
      return searchVal.includes(optVal) || searchVal.includes(optText);
    });
  }

  // Level 5: Fuzzy keyword matching
  if (!match) {
    const searchWords = searchVal.split(/[\s,\-—/]+/).filter(w => w.length > 2);
    let bestMatch = null;
    let bestScore = 0;

    options.forEach(opt => {
      if (!opt.value) return;
      const optText = opt.textContent.toLowerCase();
      let score = 0;
      searchWords.forEach(word => {
        if (optText.includes(word)) score++;
      });
      if (score > bestScore) {
        bestScore = score;
        bestMatch = opt;
      }
    });

    if (bestScore > 0) match = bestMatch;
  }

  if (match) {
    selectElement.value = match.value;
    return {
      success: true,
      message: `✓ Selected: "${match.textContent.trim()}" (value: ${match.value})`
    };
  }

  return { error: `No matching option for: "${value}"` };
}


/**
 * CHECKBOX — handles true/false, yes/no, check/uncheck
 */
function fillCheckbox(element, value) {
  const shouldCheck = parseBoolean(value);
  
  if (element.checked !== shouldCheck) {
    element.checked = shouldCheck;
    element.dispatchEvent(new Event('click', { bubbles: true }));
  }

  return {
    success: true,
    message: `✓ Checkbox ${shouldCheck ? 'checked' : 'unchecked'}`
  };
}


/**
 * RADIO BUTTON — finds the right radio in the group by value or label
 */
function fillRadio(element, value) {
  const name = element.name;
  const searchVal = String(value).toLowerCase().trim();
  
  // Get all radio buttons in this group
  const radios = document.querySelectorAll(`input[type="radio"][name="${name}"]`);
  let matched = null;

  radios.forEach(radio => {
    // Match by value
    if (radio.value.toLowerCase() === searchVal) {
      matched = radio;
      return;
    }

    // Match by associated label text
    const label = findLabelForElement(radio);
    if (label && label.textContent.toLowerCase().trim().includes(searchVal)) {
      matched = radio;
    }
  });

  // Fuzzy: try partial match on value
  if (!matched) {
    radios.forEach(radio => {
      if (radio.value.toLowerCase().includes(searchVal) || 
          searchVal.includes(radio.value.toLowerCase())) {
        matched = radio;
      }
    });
  }

  if (matched) {
    matched.checked = true;
    matched.dispatchEvent(new Event('change', { bubbles: true }));
    matched.dispatchEvent(new Event('click', { bubbles: true }));
    return {
      success: true,
      message: `✓ Selected radio: "${matched.value}"`
    };
  }

  return { error: `No matching radio option for: "${value}"` };
}


/**
 * DATE / TIME / DATETIME-LOCAL
 */
function fillDateTime(element, value, inputType) {
  let formattedValue = value;

  // Try to parse and format date strings
  try {
    if (inputType === 'date') {
      const date = new Date(value);
      if (!isNaN(date)) {
        formattedValue = date.toISOString().split('T')[0]; // YYYY-MM-DD
      }
    } else if (inputType === 'time') {
      // Accept "2:30 PM", "14:30", etc.
      formattedValue = parseTimeString(value);
    } else if (inputType === 'datetime-local') {
      const date = new Date(value);
      if (!isNaN(date)) {
        formattedValue = date.toISOString().slice(0, 16); // YYYY-MM-DDTHH:MM
      }
    } else if (inputType === 'month') {
      const date = new Date(value);
      if (!isNaN(date)) {
        formattedValue = date.toISOString().slice(0, 7); // YYYY-MM
      }
    }
  } catch (e) {
    // Use raw value if parsing fails
  }

  setNativeValue(element, formattedValue);

  return {
    success: true,
    message: `✓ Set ${inputType} to: "${formattedValue}"`
  };
}


/**
 * RANGE (slider)
 */
function fillRange(element, value) {
  const numValue = parseFloat(value);
  const min = parseFloat(element.min) || 0;
  const max = parseFloat(element.max) || 100;

  // Clamp to valid range
  const clamped = Math.min(Math.max(numValue, min), max);
  
  setNativeValue(element, String(clamped));

  return {
    success: true,
    message: `✓ Set range slider to: ${clamped} (min: ${min}, max: ${max})`
  };
}


/**
 * COLOR PICKER
 */
function fillColor(element, value) {
  let hex = value;

  // Convert color names to hex
  const colorMap = {
    red: '#ff0000', blue: '#0000ff', green: '#008000',
    black: '#000000', white: '#ffffff', yellow: '#ffff00',
    purple: '#800080', orange: '#ffa500', pink: '#ffc0cb',
    gray: '#808080', grey: '#808080', cyan: '#00ffff'
  };

  if (colorMap[value.toLowerCase()]) {
    hex = colorMap[value.toLowerCase()];
  }

  // Ensure it's a valid hex format
  if (!hex.startsWith('#')) hex = '#' + hex;
  if (hex.length === 4) {
    // Convert #RGB to #RRGGBB
    hex = '#' + hex[1]+hex[1] + hex[2]+hex[2] + hex[3]+hex[3];
  }

  element.value = hex;

  return {
    success: true,
    message: `✓ Set color to: ${hex}`
  };
}


/**
 * CONTENTEDITABLE (rich text editors like Quill, TipTap, etc.)
 */
function fillContentEditable(element, value) {
  element.innerHTML = '';
  element.textContent = value;

  // Also try setting innerText for some editors
  element.innerText = value;

  // Dispatch input event for reactive frameworks
  element.dispatchEvent(new InputEvent('input', {
    bubbles: true,
    cancelable: true,
    inputType: 'insertText',
    data: value
  }));

  return {
    success: true,
    message: `✓ Filled contenteditable with: "${value.substring(0, 50)}..."`
  };
}


// ═══════════════════════════════════════════════════
// UTILITY FUNCTIONS
// ═══════════════════════════════════════════════════

/**
 * Set value using native setter (bypasses React/Vue/Angular)
 */
function setNativeValue(element, value) {
  const descriptor = Object.getOwnPropertyDescriptor(
    Object.getPrototypeOf(element), 'value'
  );

  if (descriptor && descriptor.set) {
    descriptor.set.call(element, value);
  } else {
    element.value = value;
  }
}


/**
 * Fire all necessary events for framework compatibility
 */
function fireAllEvents(element) {
  const events = ['input', 'change', 'blur'];
  events.forEach(eventType => {
    element.dispatchEvent(new Event(eventType, { bubbles: true }));
  });

  // Also fire for React synthetic events
  element.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
}


/**
 * Parse boolean from various string formats
 */
function parseBoolean(value) {
  if (typeof value === 'boolean') return value;
  const str = String(value).toLowerCase().trim();
  return ['true', 'yes', '1', 'on', 'check', 'checked', 'enable', 'enabled'].includes(str);
}


/**
 * Find the <label> associated with an element
 */
function findLabelForElement(element) {
  // Check for label with "for" attribute
  if (element.id) {
    const label = document.querySelector(`label[for="${element.id}"]`);
    if (label) return label;
  }

  // Check if element is inside a label
  const parentLabel = element.closest('label');
  if (parentLabel) return parentLabel;

  // Check preceding sibling or nearby text
  const prev = element.previousElementSibling;
  if (prev && prev.tagName === 'LABEL') return prev;

  return null;
}


/**
 * Parse time string ("2:30 PM" → "14:30")
 */
function parseTimeString(value) {
  // Already in HH:MM format
  if (/^\d{2}:\d{2}$/.test(value)) return value;

  // Parse "2:30 PM" format
  const match = value.match(/(\d{1,2}):(\d{2})\s*(AM|PM)?/i);
  if (match) {
    let hours = parseInt(match[1]);
    const minutes = match[2];
    const period = (match[3] || '').toUpperCase();

    if (period === 'PM' && hours < 12) hours += 12;
    if (period === 'AM' && hours === 12) hours = 0;

    return `${String(hours).padStart(2, '0')}:${minutes}`;
  }

  return value;
}