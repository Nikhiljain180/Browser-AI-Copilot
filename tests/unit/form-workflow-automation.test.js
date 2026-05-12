import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('Form workflow automation', () => {
  beforeEach(async () => {
    const existingTryDirectFormWorkflow = globalThis.CopilotSw?.tryDirectFormWorkflow;
    globalThis.CopilotSw = {
      agentState: {
        formSession: { active: false, pendingFields: [], awaitingSubmitConfirmation: false },
        chatHistory: [],
        save: vi.fn(async () => {}),
      },
      ensureFormSessionState: vi.fn(() => {}),
      isFormFillGoal: vi.fn(() => false),
      isFormSubmitGoal: vi.fn(() => true),
      isFormClearGoal: vi.fn(() => false),
      isSubmitIntent: vi.fn(() => false),
      isNegativeIntent: vi.fn(() => false),
      buildFormsInventory: vi.fn((ctx) => ctx.forms),
      requestFormFillPlan: vi.fn(async () => ({})),
      validateFormWorkflowPlan: vi.fn(() => ({
        fields: [
          { agentId: 'product', selector: '#product', value: '4K Ultra Monitor 27"' },
          { agentId: 'quantity', selector: '#qty', value: '2' },
        ],
        missingFields: [],
        nextAction: 'done',
        submitButtons: [{ agentId: 'submit_btn', selector: '#submit', text: 'Submit' }],
        targetButton: null,
      })),
      executeTool: vi.fn(async () => ({ success: true })),
      sendMessageToTab: vi.fn(async () => ({
        forms: [
          {
            fields: [
              { agentId: 'product', selector: '#product', required: true, isFilled: true },
              { agentId: 'quantity', selector: '#qty', required: true, isFilled: true },
              { agentId: 'email', selector: '#email', required: true, isFilled: false, type: 'email' },
            ],
            submitButtons: [{ agentId: 'submit_btn', selector: '#submit', text: 'Submit' }],
            buttons: [],
          },
        ],
      })),
      resolveSubmitButton: vi.fn(() => ({ agentId: 'submit_btn', selector: '#submit', text: 'Submit' })),
      executeToolWithApproval: vi.fn(async () => ({ success: true })),
      updateAgentStatus: vi.fn(),
      clearFormSession: vi.fn(),
      setFormSession: vi.fn(),
      isFileUploadField: vi.fn(() => false),
      normalizeFieldRef: vi.fn((item) => item),
      buildFieldLookup: vi.fn((fields = []) => {
        const map = new Map();
        fields.forEach((field) => {
          if (field?.agentId) map.set(field.agentId, field);
          if (field?.selector) map.set(field.selector, field);
        });
        return map;
      }),
      fieldKey: vi.fn((field) => field?.selector || field?.agentId || field?.label || ''),
      askForField: vi.fn((field) => `Please provide ${field.label || field.selector}.`),
    };

    if (!existingTryDirectFormWorkflow) {
      await import('../../apps/extension/src/background/workflows/form-workflow.js');
    } else {
      globalThis.CopilotSw.tryDirectFormWorkflow = existingTryDirectFormWorkflow;
    }
  });

  it('fills planned fields before asking missing required fields on submit', async () => {
    const pageContext = {
      forms: [
        {
          fields: [
            { agentId: 'product', selector: '#product', required: true, isFilled: false },
            { agentId: 'quantity', selector: '#qty', required: true, isFilled: false },
            { agentId: 'email', selector: '#email', required: true, isFilled: false, type: 'email' },
          ],
          submitButtons: [{ agentId: 'submit_btn', selector: '#submit', text: 'Submit' }],
          buttons: [],
        },
      ],
      buttons: [],
      url: 'http://ecommerce.local/',
    };

    const answer = await globalThis.CopilotSw.tryDirectFormWorkflow('submit order', pageContext, 1);

    const fillCalls = globalThis.CopilotSw.executeTool.mock.calls.filter(([name]) => name === 'fill_input');
    expect(fillCalls.length).toBe(2);
    expect(globalThis.CopilotSw.sendMessageToTab).toHaveBeenCalled();
    expect(answer.toLowerCase()).toContain('email');
    expect(answer).not.toContain('Please provide Product');
    expect(answer).not.toContain('Please provide Quantity');
  });

  it('auto-submits after final missing field when submit was requested earlier', async () => {
    globalThis.CopilotSw.agentState.formSession = {
      active: true,
      pendingFields: [{ agentId: 'email', selector: '#email', label: 'Email' }],
      lastAskedField: { agentId: 'email', selector: '#email', label: 'Email' },
      awaitingSubmitConfirmation: false,
      autoSubmitRequested: true,
      submitButtons: [{ agentId: 'submit_btn', selector: '#submit', text: 'Submit' }],
      targetButton: { agentId: 'submit_btn', selector: '#submit', text: 'Submit' },
    };

    const pageContext = {
      forms: [
        {
          fields: [{ agentId: 'email', selector: '#email', required: true, isFilled: false, type: 'email' }],
          submitButtons: [{ agentId: 'submit_btn', selector: '#submit', text: 'Submit' }],
          buttons: [],
        },
      ],
      buttons: [{ agentId: 'submit_btn', selector: '#submit', text: 'Submit' }],
      url: 'http://ecommerce.local/',
    };

    const answer = await globalThis.CopilotSw.tryDirectFormWorkflow(
      'nikhiljain180@gmail.com',
      pageContext,
      1,
    );

    expect(globalThis.CopilotSw.executeTool).toHaveBeenCalledWith(
      'fill_input',
      expect.objectContaining({ selector: '#email', value: 'nikhiljain180@gmail.com' }),
      1,
    );
    expect(globalThis.CopilotSw.executeToolWithApproval).toHaveBeenCalledWith(
      'click_element',
      expect.objectContaining({ selector: '#submit' }),
      1,
    );
    expect(String(answer).toLowerCase()).toContain('submitted');
  });

  it('keeps partial fills when one positional segment fails validation (multi-field)', async () => {
    globalThis.CopilotSw.requestPendingFieldMap = vi.fn(async () => ({ content: '{}' }));

    globalThis.CopilotSw.executeTool = vi.fn(async (_tool, input) => {
      if (input?.selector === '#email') {
        return { error: 'invalid email' };
      }
      return { success: true };
    });

    globalThis.CopilotSw.agentState.formSession = {
      active: true,
      pendingFields: [
        { agentId: 'name_f', selector: '#name', label: 'Full Name' },
        { agentId: 'email_f', selector: '#email', label: 'Email', type: 'email' },
        { agentId: 'ship_f', selector: '#ship', label: 'Shipping Address' },
      ],
      lastAskedField: { agentId: 'name_f', selector: '#name', label: 'Full Name' },
      awaitingSubmitConfirmation: false,
    };

    const pageContext = {
      forms: [
        {
          fields: [
            { agentId: 'name_f', selector: '#name', label: 'Full Name', required: true, isFilled: false },
            {
              agentId: 'email_f',
              selector: '#email',
              label: 'Email',
              type: 'email',
              required: true,
              isFilled: false,
            },
            {
              agentId: 'ship_f',
              selector: '#ship',
              label: 'Shipping Address',
              required: true,
              isFilled: false,
            },
          ],
          submitButtons: [],
          buttons: [],
        },
      ],
      url: 'http://example.com/',
    };

    await globalThis.CopilotSw.tryDirectFormWorkflow(
      'Jane Doe\nnot-an-email\n123 Oak St',
      pageContext,
      1,
    );

    const fills = globalThis.CopilotSw.executeTool.mock.calls.filter(([name]) => name === 'fill_input');
    expect(fills.length).toBe(3);
    expect(fills.some(([, inp]) => inp.selector === '#name' && inp.value === 'Jane Doe')).toBe(true);
    expect(fills.some(([, inp]) => inp.selector === '#ship' && inp.value === '123 Oak St')).toBe(true);
    expect(globalThis.CopilotSw.agentState.formSession.pendingFields.length).toBe(1);
    expect(globalThis.CopilotSw.agentState.formSession.pendingFields[0].agentId).toBe('email_f');
  });

  it('fills email + shipping from bare line and typo label line in one message', async () => {
    globalThis.CopilotSw.requestPendingFieldMap = vi.fn(async () => {
      throw new Error('LLM should not run when heuristics succeed');
    });

    globalThis.CopilotSw.agentState.formSession = {
      active: true,
      pendingFields: [
        { agentId: 'email_field', selector: '#email', label: 'Email' },
        { agentId: 'ship_field', selector: '#ship', label: 'Shipping Address' },
      ],
      lastAskedField: { agentId: 'email_field', selector: '#email', label: 'Email' },
      awaitingSubmitConfirmation: false,
    };

    const pageContext = {
      forms: [
        {
          fields: [
            {
              agentId: 'email_field',
              selector: '#email',
              label: 'Email',
              type: 'email',
              required: true,
              isFilled: false,
            },
            {
              agentId: 'ship_field',
              selector: '#ship',
              label: 'Shipping Address',
              required: true,
              isFilled: false,
            },
          ],
          submitButtons: [],
          buttons: [],
        },
      ],
      url: 'http://example.com/order',
    };

    await globalThis.CopilotSw.tryDirectFormWorkflow(
      'nikhiljain180@gmail.com\nadderss : h-213',
      pageContext,
      1,
    );

    const fills = globalThis.CopilotSw.executeTool.mock.calls.filter(([name]) => name === 'fill_input');
    expect(fills.length).toBe(2);
    expect(fills.some(([, inp]) => inp.value === 'nikhiljain180@gmail.com')).toBe(true);
    expect(fills.some(([, inp]) => inp.value === 'h-213')).toBe(true);
    expect(globalThis.CopilotSw.requestPendingFieldMap).not.toHaveBeenCalled();
  });

  it('fills two pending fields separated by ". "', async () => {
    globalThis.CopilotSw.agentState.formSession = {
      active: true,
      pendingFields: [
        { agentId: 'email_field', selector: '#email', label: 'Email' },
        { agentId: 'ship_field', selector: '#ship', label: 'Shipping Address' },
      ],
      lastAskedField: { agentId: 'email_field', selector: '#email', label: 'Email' },
      awaitingSubmitConfirmation: false,
    };

    const pageContext = {
      forms: [
        {
          fields: [
            {
              agentId: 'email_field',
              selector: '#email',
              label: 'Email',
              type: 'email',
              required: true,
              isFilled: false,
            },
            {
              agentId: 'ship_field',
              selector: '#ship',
              label: 'Shipping Address',
              required: true,
              isFilled: false,
            },
          ],
          submitButtons: [],
          buttons: [],
        },
      ],
      url: 'http://example.com/order',
    };

    await globalThis.CopilotSw.tryDirectFormWorkflow('nikhiljain180@gmail.com. h-213', pageContext, 1);

    const fills = globalThis.CopilotSw.executeTool.mock.calls.filter(([name]) => name === 'fill_input');
    expect(fills.length).toBe(2);
  });

  it('does not fill or replan when user says yes while fields are still pending', async () => {
    globalThis.CopilotSw.isSubmitIntent = (goal) => {
      const t = String(goal || '')
        .toLowerCase()
        .trim();
      return ['yes', 'y', 'ok', 'okay', 'submit', 'send'].includes(t);
    };

    globalThis.CopilotSw.agentState.formSession = {
      active: true,
      pendingFields: [{ agentId: 'email', selector: '#email', label: 'Email Address' }],
      lastAskedField: { agentId: 'email', selector: '#email', label: 'Email Address' },
      awaitingSubmitConfirmation: false,
    };

    const pageContext = {
      forms: [
        {
          fields: [
            {
              agentId: 'email',
              selector: '#email',
              label: 'Email Address',
              type: 'email',
              required: true,
              isFilled: false,
            },
          ],
          submitButtons: [],
          buttons: [],
        },
      ],
      buttons: [],
      url: 'http://ecommerce.local/',
    };

    const answer = await globalThis.CopilotSw.tryDirectFormWorkflow('yes', pageContext, 1);

    expect(globalThis.CopilotSw.executeTool).not.toHaveBeenCalled();
    expect(String(answer).toLowerCase()).toMatch(/not just "yes"|real value/);
  });

  it('parses comma-separated name, email, and shipping into multiple pending fields', async () => {
    globalThis.CopilotSw.agentState.formSession = {
      active: true,
      pendingFields: [
        { agentId: 'name', selector: '#customer-name', label: 'Full Name' },
        { agentId: 'email', selector: '#email', label: 'Email Address' },
        { agentId: 'addr', selector: '#shipping-address', label: 'Shipping Address' },
      ],
      lastAskedField: { agentId: 'name', selector: '#customer-name', label: 'Full Name' },
      awaitingSubmitConfirmation: false,
    };

    const pageContext = {
      forms: [
        {
          fields: [
            {
              agentId: 'name',
              selector: '#customer-name',
              label: 'Full Name',
              required: true,
              isFilled: false,
            },
            {
              agentId: 'email',
              selector: '#email',
              label: 'Email Address',
              type: 'email',
              required: true,
              isFilled: false,
            },
            {
              agentId: 'addr',
              selector: '#shipping-address',
              label: 'Shipping Address',
              required: true,
              isFilled: false,
            },
          ],
          submitButtons: [],
          buttons: [],
        },
      ],
      buttons: [],
      url: 'http://ecommerce.local/',
    };

    await globalThis.CopilotSw.tryDirectFormWorkflow(
      'Sarah Miller, sarah@example.com, 123 Main St, Austin, TX 78701',
      pageContext,
      1,
    );

    const fills = globalThis.CopilotSw.executeTool.mock.calls.filter(([name]) => name === 'fill_input');
    expect(fills.length).toBe(3);
    expect(fills.map(([, args]) => args.selector)).toEqual(
      expect.arrayContaining(['#customer-name', '#email', '#shipping-address']),
    );
  });

  it('maps two unlabeled comma values to email + shipping (not name) when only those are pending', async () => {
    globalThis.CopilotSw.agentState.formSession = {
      active: true,
      pendingFields: [
        { agentId: 'addr', selector: '#shipping-address', label: 'Shipping Address' },
        { agentId: 'email', selector: '#email', label: 'Email Address' },
      ],
      lastAskedField: { agentId: 'addr', selector: '#shipping-address', label: 'Shipping Address' },
      awaitingSubmitConfirmation: false,
    };

    const pageContext = {
      forms: [
        {
          fields: [
            {
              agentId: 'addr',
              selector: '#shipping-address',
              label: 'Shipping Address',
              required: true,
              isFilled: false,
            },
            {
              agentId: 'email',
              selector: '#email',
              label: 'Email Address',
              type: 'email',
              required: true,
              isFilled: false,
            },
          ],
          submitButtons: [],
          buttons: [],
        },
      ],
      buttons: [],
      url: 'http://ecommerce.local/',
    };

    await globalThis.CopilotSw.tryDirectFormWorkflow('abc, nikhiljain180@gmail.com', pageContext, 1);

    const fills = globalThis.CopilotSw.executeTool.mock.calls.filter(([name]) => name === 'fill_input');
    expect(fills).toContainEqual([
      'fill_input',
      expect.objectContaining({ selector: '#shipping-address', value: 'abc' }),
      1,
    ]);
    expect(fills).toContainEqual([
      'fill_input',
      expect.objectContaining({ selector: '#email', value: 'nikhiljain180@gmail.com' }),
      1,
    ]);
  });

  it('maps one value per line to pending fields in order (multiline)', async () => {
    globalThis.CopilotSw.agentState.formSession = {
      active: true,
      pendingFields: [
        { agentId: 'n', selector: '#customer-name', label: 'Full Name' },
        { agentId: 'e', selector: '#email', label: 'Email Address' },
        { agentId: 's', selector: '#shipping-address', label: 'Shipping Address' },
        { agentId: 'q', selector: '#quantity', label: 'Quantity' },
      ],
      lastAskedField: { agentId: 'n', selector: '#customer-name', label: 'Full Name' },
      awaitingSubmitConfirmation: false,
    };

    const pageContext = {
      forms: [
        {
          fields: [
            { agentId: 'n', selector: '#customer-name', label: 'Full Name', required: true, isFilled: false },
            { agentId: 'e', selector: '#email', label: 'Email Address', type: 'email', required: true, isFilled: false },
            { agentId: 's', selector: '#shipping-address', label: 'Shipping Address', required: true, isFilled: false },
            { agentId: 'q', selector: '#quantity', label: 'Quantity', type: 'number', required: true, isFilled: false },
          ],
          submitButtons: [],
          buttons: [],
        },
      ],
      buttons: [],
      url: 'http://ecommerce.local/',
    };

    const block = ['Nikhil Jain', 'nikhiljain180@gmail.com', 'abc', '1'].join('\n');
    await globalThis.CopilotSw.tryDirectFormWorkflow(block, pageContext, 1);

    const fills = globalThis.CopilotSw.executeTool.mock.calls.filter(([name]) => name === 'fill_input');
    expect(fills.length).toBe(4);
    expect(fills).toContainEqual([
      'fill_input',
      expect.objectContaining({ selector: '#shipping-address', value: 'abc' }),
      1,
    ]);
    expect(fills).toContainEqual([
      'fill_input',
      expect.objectContaining({ selector: '#quantity', value: '1' }),
      1,
    ]);
  });

  it('matches long label keys like "full shipping address" to Shipping Address field', async () => {
    globalThis.CopilotSw.agentState.formSession = {
      active: true,
      pendingFields: [{ agentId: 's', selector: '#shipping-address', label: 'Shipping Address' }],
      lastAskedField: { agentId: 's', selector: '#shipping-address', label: 'Shipping Address' },
      awaitingSubmitConfirmation: false,
    };

    const pageContext = {
      forms: [
        {
          fields: [
            {
              agentId: 's',
              selector: '#shipping-address',
              label: 'Shipping Address',
              required: true,
              isFilled: false,
            },
          ],
          submitButtons: [],
          buttons: [],
        },
      ],
      buttons: [],
      url: 'http://ecommerce.local/',
    };

    await globalThis.CopilotSw.tryDirectFormWorkflow('full shipping address : abc', pageContext, 1);

    expect(globalThis.CopilotSw.executeTool).toHaveBeenCalledWith(
      'fill_input',
      expect.objectContaining({ selector: '#shipping-address', value: 'abc' }),
      1,
    );
  });

  it('does not clear form session when LLM returns done but inventory still has required gaps', async () => {
    globalThis.CopilotSw.isFormSubmitGoal = vi.fn(() => false);
    globalThis.CopilotSw.shouldTreatMessageAsFormValueFollowUp = vi.fn(() => true);
    globalThis.CopilotSw.validateFormWorkflowPlan = vi.fn(() => ({
      fields: [],
      missingFields: [],
      nextAction: 'done',
      summary: '',
      targetButton: null,
      submitButtons: [],
    }));

    globalThis.CopilotSw.agentState.formSession = {
      active: false,
      pendingFields: [],
      awaitingSubmitConfirmation: false,
    };

    const pageContext = {
      forms: [
        {
          fields: [
            {
              agentId: 'ship',
              selector: '#ship',
              label: 'Shipping Address',
              required: true,
              isFilled: false,
            },
          ],
          submitButtons: [],
          buttons: [],
        },
      ],
      buttons: [],
      url: 'http://example.com/',
    };

    const msg = await globalThis.CopilotSw.tryDirectFormWorkflow('abc', pageContext, 1);

    expect(globalThis.CopilotSw.clearFormSession).not.toHaveBeenCalled();
    expect(String(msg).toLowerCase()).toMatch(/still need|few details/);
  });
});
