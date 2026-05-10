/**
 * Draft Reply
 * Handles: textarea, input, contenteditable, rich text editors
 * Supports: compose, reply, append, rich text, character limits
 */
function draftReply(toolInput = {}) {
  try {
    const {
      selector,
      agent_id,
      agentId,
      draft = '',
      context = '',
      tone = 'professional',
      mode = 'replace', // 'replace' | 'append' | 'prepend'
      format = 'plain', // 'plain' | 'html' | 'markdown'
      maxLength = null, // character limit (null = no limit)
      mentionUser = null, // @mention to prepend
      signature = null, // signature to append
      autoFocus = true,
    } = toolInput;

    // ── 1. Find the reply field ──
    const element = resolveReplyField({
      selector,
      agent_id,
      agentId,
    });

    if (!element) {
      return {
        error: `Reply field not found. Tried: ${selector || 'auto-detect'}`,
        suggestion: 'Try providing a more specific selector or ensure the reply field is visible',
      };
    }

    // ── 2. Get field info & constraints ──
    const fieldInfo = analyzeReplyField(element);

    // ── 3. Build the final draft text ──
    const draftText = buildDraft({
      draft,
      context,
      tone,
      mentionUser,
      signature,
      format,
      fieldInfo,
    });

    // ── 4. Apply character limit ──
    const limit = maxLength || fieldInfo.maxLength;
    const finalText = limit ? truncateWithWarning(draftText, limit) : draftText;

    // ── 5. Get existing content (for append/prepend) ──
    const existingContent = getFieldContent(element, fieldInfo);

    // ── 6. Calculate final content based on mode ──
    let contentToSet;
    switch (mode) {
      case 'append':
        contentToSet = existingContent ? `${existingContent}\n\n${finalText}` : finalText;
        break;
      case 'prepend':
        contentToSet = existingContent ? `${finalText}\n\n${existingContent}` : finalText;
        break;
      case 'replace':
      default:
        contentToSet = finalText;
        break;
    }

    // ── 7. Set the content based on field type ──
    const setResult = setReplyContent(element, contentToSet, fieldInfo, format);
    if (setResult.error) return setResult;

    // ── 8. Focus the field ──
    if (autoFocus) {
      element.focus();
      // Place cursor at end
      placeCursorAtEnd(element, fieldInfo);
    }

    return {
      success: true,
      draft: contentToSet,
      characterCount: contentToSet.length,
      characterLimit: limit || 'none',
      mode,
      fieldType: fieldInfo.type,
      selector: generateSelector(element),
      timestamp: Date.now(),
    };
  } catch (error) {
    return { error: error.message };
  }
}

// ═══════════════════════════════════════════════════
// REPLY FIELD DETECTION
// ═══════════════════════════════════════════════════

/**
 * Smart reply field finder
 * Works on: email clients, social media, chat apps, forums, CRMs
 */
function resolveReplyField(target) {
  // Try explicit selectors first
  if (target.selector) {
    const el = document.querySelector(target.selector);
    if (el) return el;
  }

  if (target.agent_id || target.agentId) {
    const el = resolveElement(target);
    if (el) return el;
  }

  // Auto-detect reply/compose fields
  const replySelectors = [
    // Explicit reply fields
    '[aria-label*="reply" i]',
    '[aria-label*="compose" i]',
    '[aria-label*="message" i]',
    '[aria-label*="comment" i]',
    '[placeholder*="reply" i]',
    '[placeholder*="write" i]',
    '[placeholder*="type" i]',
    '[placeholder*="comment" i]',
    '[placeholder*="message" i]',

    // Common reply field patterns
    '[name*="reply"]',
    '[name*="comment"]',
    '[name*="message"]',
    '[id*="reply"]',
    '[id*="comment"]',
    '[id*="message"]',
    '[data-field*="reply"]',
    '[data-field*="comment"]',

    // Rich text editors
    '[contenteditable="true"][role="textbox"]',
    '[contenteditable="true"][aria-label]',
    '.ql-editor', // Quill
    '.ProseMirror', // ProseMirror / TipTap
    '.tox-edit-area__iframe', // TinyMCE
    '[class*="editor"][contenteditable]',
    '.DraftEditor-root', // Draft.js (Facebook)
    '[data-gramm="false"]', // Grammarly-enabled fields

    // Generic textarea (last resort)
    'textarea:not([hidden])',
    'textarea',
  ];

  for (const selector of replySelectors) {
    try {
      const elements = document.querySelectorAll(selector);
      for (const el of elements) {
        if (isElementVisible(el) && !isDisabled(el)) {
          return el;
        }
      }
    } catch (e) {
      continue;
    }
  }

  return null;
}

// ═══════════════════════════════════════════════════
// FIELD ANALYSIS
// ═══════════════════════════════════════════════════

/**
 * Analyze the reply field to understand its type and constraints
 */
function analyzeReplyField(element) {
  const tagName = element.tagName.toUpperCase();
  const info = {
    tagName: tagName.toLowerCase(),
    type: 'unknown',
    maxLength: null,
    isRichText: false,
    isIframe: false,
    supportsHtml: false,
    currentLength: 0,
    label: '',
    placeholder: '',
  };

  // ── Textarea ──
  if (tagName === 'TEXTAREA') {
    info.type = 'textarea';
    info.maxLength = element.maxLength > 0 ? element.maxLength : null;
    info.currentLength = element.value.length;
    info.placeholder = element.placeholder || '';
    info.label = getFieldLabel(element);
  }

  // ── Input (text, email, etc.) ──
  else if (tagName === 'INPUT') {
    info.type = 'input';
    info.maxLength = element.maxLength > 0 ? element.maxLength : null;
    info.currentLength = element.value.length;
    info.placeholder = element.placeholder || '';
    info.label = getFieldLabel(element);
  }

  // ── ContentEditable ──
  else if (element.contentEditable === 'true' || element.isContentEditable) {
    info.type = 'contenteditable';
    info.isRichText = true;
    info.supportsHtml = true;
    info.currentLength = (element.innerText || '').length;
    info.label = element.getAttribute('aria-label') || '';
    info.placeholder =
      element.getAttribute('data-placeholder') || element.getAttribute('aria-placeholder') || '';

    // Detect editor type
    if (element.classList.contains('ql-editor')) info.editor = 'quill';
    else if (element.classList.contains('ProseMirror')) info.editor = 'prosemirror';
    else if (element.closest('.DraftEditor-root')) info.editor = 'draftjs';
    else info.editor = 'generic';
  }

  // ── Iframe (TinyMCE, CKEditor) ──
  else if (tagName === 'IFRAME') {
    info.type = 'iframe';
    info.isIframe = true;
    info.isRichText = true;
    info.supportsHtml = true;

    try {
      const iframeDoc = element.contentDocument || element.contentWindow.document;
      const body = iframeDoc.body;
      info.currentLength = (body?.innerText || '').length;
    } catch (e) {
      info.currentLength = 0;
    }
  }

  return info;
}

// ═══════════════════════════════════════════════════
// CONTENT OPERATIONS
// ═══════════════════════════════════════════════════

/**
 * Get existing content from any field type
 */
function getFieldContent(element, fieldInfo) {
  switch (fieldInfo.type) {
    case 'textarea':
    case 'input':
      return element.value || '';

    case 'contenteditable':
      return element.innerText || '';

    case 'iframe':
      try {
        const doc = element.contentDocument || element.contentWindow.document;
        return doc.body?.innerText || '';
      } catch (e) {
        return '';
      }

    default:
      return element.value || element.innerText || '';
  }
}

/**
 * Set content into any reply field type
 */
function setReplyContent(element, content, fieldInfo, format) {
  try {
    switch (fieldInfo.type) {
      case 'textarea':
      case 'input':
        setNativeValue(element, content);
        element.dispatchEvent(new Event('input', { bubbles: true }));
        element.dispatchEvent(new Event('change', { bubbles: true }));
        break;

      case 'contenteditable':
        setContentEditableValue(element, content, format, fieldInfo.editor);
        break;

      case 'iframe':
        setIframeContent(element, content, format);
        break;

      default:
        // Try both approaches
        if (element.value !== undefined) {
          setNativeValue(element, content);
        } else {
          element.innerText = content;
        }
        element.dispatchEvent(new Event('input', { bubbles: true }));
        element.dispatchEvent(new Event('change', { bubbles: true }));
        break;
    }

    return { success: true };
  } catch (error) {
    return { error: `Failed to set content: ${error.message}` };
  }
}

/**
 * Set content in contenteditable elements (rich text editors)
 */
function setContentEditableValue(element, content, format, editorType) {
  // Clear existing content
  element.innerHTML = '';

  if (format === 'html' && element.isContentEditable) {
    element.innerHTML = ContentSanitizer.sanitizeHTML(content);
  } else if (format === 'markdown') {
    element.innerHTML = ContentSanitizer.sanitizeHTML(markdownToBasicHtml(content));
  } else {
    // Plain text — preserve line breaks
    element.innerText = content;
  }

  // Fire events for different editor frameworks
  // Standard input event
  element.dispatchEvent(
    new InputEvent('input', {
      bubbles: true,
      cancelable: true,
      inputType: 'insertText',
      data: content,
    }),
  );

  // For React-based editors (Draft.js, Slate)
  element.dispatchEvent(new Event('input', { bubbles: true }));
  element.dispatchEvent(new Event('change', { bubbles: true }));
  element.dispatchEvent(new Event('blur', { bubbles: true }));
  element.dispatchEvent(new Event('focus', { bubbles: true }));

  // For ProseMirror/TipTap — dispatch a transaction
  if (editorType === 'prosemirror') {
    try {
      const view = element.pmViewDesc?.view;
      if (view) {
        const tr = view.state.tr.insertText(content, 0, view.state.doc.content.size);
        view.dispatch(tr);
      }
    } catch (e) {
      // Fallback already set above
    }
  }
}

/**
 * Set content in iframe-based editors (TinyMCE, CKEditor)
 */
function setIframeContent(iframe, content, format) {
  try {
    const doc = iframe.contentDocument || iframe.contentWindow.document;
    const body = doc.body;

    if (format === 'html') {
      body.innerHTML = ContentSanitizer.sanitizeHTML(content);
    } else {
      body.innerText = content;
    }

    // Trigger events in iframe context
    body.dispatchEvent(new Event('input', { bubbles: true }));
  } catch (e) {
    throw new Error(`Cannot access iframe content: ${e.message}`);
  }
}

// ═══════════════════════════════════════════════════
// DRAFT BUILDING
// ═══════════════════════════════════════════════════

/**
 * Build the final draft text
 * AI should provide the draft — this is a smart fallback
 */
function buildDraft({ draft, context, tone, mentionUser, signature, format, fieldInfo }) {
  // If AI provided a draft, use it directly
  if (draft && draft.trim()) {
    let finalDraft = draft.trim();

    // Prepend @mention if needed
    if (mentionUser) {
      finalDraft = `@${mentionUser.replace('@', '')} ${finalDraft}`;
    }

    // Append signature if provided
    if (signature) {
      finalDraft += `\n\n${signature}`;
    }

    return finalDraft;
  }

  // ── Fallback: Build a template based on context + tone ──
  return buildTemplateDraft(context, tone, mentionUser, signature);
}

/**
 * Fallback template builder with better tone support
 */
function buildTemplateDraft(context, tone, mentionUser, signature) {
  const safeContext = (context || '').trim().replace(/\s+/g, ' ').slice(0, 300);

  // Tone templates
  const toneMap = {
    professional: {
      greeting: 'Hi,',
      thankYou: 'Thank you for your message.',
      closing: 'Best regards,',
    },
    formal: {
      greeting: 'Dear Sir/Madam,',
      thankYou: 'Thank you for reaching out to us.',
      closing: 'Yours sincerely,',
    },
    casual: {
      greeting: 'Hey! 👋',
      thankYou: 'Thanks for reaching out!',
      closing: 'Cheers,',
    },
    friendly: {
      greeting: 'Hi there!',
      thankYou: 'Thanks so much for your message!',
      closing: 'All the best,',
    },
    empathetic: {
      greeting: 'Hi,',
      thankYou: 'I understand your concern and appreciate you bringing this to our attention.',
      closing: "We're here to help,",
    },
    apologetic: {
      greeting: 'Hi,',
      thankYou: 'I sincerely apologize for the inconvenience.',
      closing: 'We appreciate your patience,',
    },
    sales: {
      greeting: 'Hi there!',
      thankYou: 'Great to hear from you!',
      closing: 'Looking forward to hearing from you,',
    },
  };

  const t = toneMap[tone] || toneMap.professional;

  let parts = [];

  // Mention
  if (mentionUser) {
    parts.push(`@${mentionUser.replace('@', '')}`);
  }

  // Greeting
  parts.push(t.greeting);
  parts.push('');

  // Thank you / opening
  parts.push(t.thankYou);

  // Context reference
  if (safeContext) {
    parts.push(`Regarding "${safeContext}":`);
    parts.push('');
    parts.push('- ');
  }

  parts.push('');

  // Closing
  parts.push(t.closing);

  // Signature
  if (signature) {
    parts.push(signature);
  }

  return parts.join('\n');
}

// ═══════════════════════════════════════════════════
// CONTEXT EXTRACTION (for AI to generate better drafts)
// ═══════════════════════════════════════════════════

/**
 * Extract conversation context around a reply field
 * Gives the AI the thread/message being replied to
 */
function _extractReplyContext(replyFieldSelector) {
  const field = replyFieldSelector
    ? document.querySelector(replyFieldSelector)
    : resolveReplyField({});

  if (!field) return { error: 'Reply field not found' };

  const context = {
    replyFieldFound: true,
    replyFieldSelector: generateSelector(field),
    replyFieldLabel: getFieldLabel(field) || field.getAttribute('aria-label') || '',
    conversationThread: [],
    originalMessage: '',
    sender: '',
    subject: '',
  };

  // ── Find the parent container (message thread, comment section, etc.) ──
  const container =
    field.closest(
      'article, .message-thread, .comment-section, .conversation, ' +
        '.ticket-detail, [class*="thread"], [class*="message"], ' +
        '[class*="comment"], [class*="reply"], section, .card, .panel',
    ) || field.parentElement;

  if (!container) return context;

  // ── Extract the message being replied to ──
  const messageSelectors = [
    '.message-content',
    '.comment-body',
    '.review-text',
    '.ticket-content',
    '.post-body',
    '.email-body',
    '[class*="message"]',
    '[class*="content"]',
    'blockquote',
    'p',
  ];

  for (const selector of messageSelectors) {
    const messages = container.querySelectorAll(selector);
    if (messages.length > 0) {
      context.conversationThread = Array.from(messages).map((msg) => ({
        text: sanitizeText(msg.innerText).substring(0, 500),
        isQuoted:
          msg.tagName === 'BLOCKQUOTE' ||
          msg.classList.contains('quoted') ||
          msg.classList.contains('original'),
      }));
      context.originalMessage = context.conversationThread[0]?.text || '';
      break;
    }
  }

  // ── Extract sender/author ──
  const senderSelectors = [
    '.sender',
    '.author',
    '.username',
    '.reviewer-name',
    '.review-name',
    '[class*="author"]',
    '[class*="sender"]',
    '[class*="name"]',
  ];

  for (const selector of senderSelectors) {
    const senderEl = container.querySelector(selector);
    if (senderEl) {
      context.sender = sanitizeText(senderEl.innerText).substring(0, 50);
      break;
    }
  }

  // ── Extract subject/title ──
  const subjectEl = container.querySelector(
    'h1, h2, h3, .subject, [class*="subject"], [class*="title"]',
  );
  if (subjectEl) {
    context.subject = sanitizeText(subjectEl.innerText).substring(0, 100);
  }

  // ── Detect reply patterns from text ──
  const fullText = container.innerText || '';
  const patterns = extractByPatterns(container);
  if (patterns.emails) context.emailsInThread = patterns.emails;
  if (patterns.dates) context.datesInThread = patterns.dates;

  return context;
}
