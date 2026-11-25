export const SCENARIOS = {
  nm3OutcomeOk: {
    from: ['PAYING'], logicalFrom: ['PAYING'], state: 'PAID', logical: 'PAID', trigger: 'sendPaymentOutcomeV2'
  },
  nm3OutcomeKo: {
    from: ['PAYING'], logicalFrom: ['PAYING'], state: 'FAILED', logical: 'INSERTED', trigger: 'sendPaymentOutcomeV2'
  },
  closeOk: {
    from: ['PAYING', 'PAYING_RPT'], logicalFrom: ['PAYING'], state: 'PAYMENT_RESERVED', trigger: 'closePayment-v2'
  },
  closeKo: {
    from: ['PAYING', 'PAYING_RPT'], logicalFrom: ['PAYING'], state: 'CANCELLED', logical: 'INSERTED', trigger: 'closePayment-v2'
  },
  closeInvalid: {
    from: ['PAYING', 'PAYING_RPT'], logicalFrom: ['PAYING'], state: 'CANCELLED', logical: 'INSERTED', trigger: 'closePayment-v2'
  },
  pspSend: {
    from: ['PAYMENT_RESERVED'], logicalFrom: ['PAYING'], state: 'PAYMENT_SENT', trigger: 'pspNotifyPaymentV2'
  },
  pspAccepted: {
    from: ['PAYMENT_SENT'], logicalFrom: ['PAYING'], state: 'PAYMENT_ACCEPTED', trigger: 'pspNotifyPaymentV2'
  },
  pspRefused: {
    from: ['PAYMENT_SENT'], logicalFrom: ['PAYING'], state: 'PAYMENT_REFUSED', trigger: 'pspNotifyPaymentV2'
  },
  pspUnknown: {
    from: ['PAYMENT_SENT'], logicalFrom: ['PAYING'], state: 'PAYMENT_UNKNOWN', trigger: 'pspNotifyPaymentV2'
  },
  pspSendError: {
    from: ['PAYMENT_SENT'], logicalFrom: ['PAYING'], state: 'PAYMENT_SEND_ERROR', trigger: 'pspNotifyPaymentV2'
  },
  outcomeOk: {
    from: ['PAYMENT_ACCEPTED', 'PAYMENT_UNKNOWN'], logicalFrom: ['PAYING'],
    state: 'PAID', logical: 'PAID', trigger: 'sendPaymentOutcomeV2'
  },
  resultKo: {
    from: ['PAYMENT_REFUSED', 'PAYMENT_SEND_ERROR'], logicalFrom: ['PAYING'],
    state: 'CANCELLED', logical: 'INSERTED', trigger: 'sendPaymentResult-v2'
  },
  expireUnknown: {
    from: ['PAYMENT_UNKNOWN'], logicalFrom: ['PAYING'], state: 'CANCELLED', logical: 'INSERTED', trigger: 'mod3CancelV2'
  },
  generateReceipt: {
    from: ['PAID'], logicalFrom: ['PAID'], state: 'NOTICE_GENERATED',
    recipient: 'NOTICE_GENERATED', trigger: 'sendPaymentOutcomeV2'
  },
  sendReceipt: {
    from: ['NOTICE_GENERATED'], logicalFrom: ['PAID'], state: 'NOTICE_SENT',
    recipient: 'NOTICE_SENT', recipientFrom: ['NOTICE_GENERATED'], trigger: 'sendPaymentOutcomeV2'
  },
  primaryResponse: {
    from: ['NOTICE_SENT'], logicalFrom: ['PAID', 'NOTICE_STORED'], logical: 'NOTIFIED',
    recipient: 'NOTIFIED', recipientFrom: ['NOTICE_SENT'], firstRecipientOnly: true, trigger: 'sendPaymentOutcomeV2'
  },
  completeReceipt: {
    from: ['NOTICE_SENT'], logicalFrom: ['PAID', 'NOTIFIED', 'NOTICE_STORED'],
    state: 'NOTIFIED', logical: 'NOTIFIED', recipient: 'NOTIFIED',
    recipientFrom: ['NOTICE_SENT', 'NOTIFIED'], trigger: 'sendPaymentOutcomeV2'
  },
  receiptTimeout: { from: ['NOTICE_SENT'], logicalFrom: ['PAID', 'NOTIFIED', 'NOTICE_STORED'],
    recipient: 'NOTICE_PENDING', recipientFrom: ['NOTICE_SENT'], trigger: 'paSendRTV2' },
  retryReceipt: { from: ['NOTICE_SENT'], logicalFrom: ['PAID', 'NOTIFIED', 'NOTICE_STORED'],
    recipient: 'NOTICE_SENT', recipientFrom: ['NOTICE_PENDING'], trigger: 'RetryPaSendRtActor' },
  retryResult: { from: ['CANCELLED'], logicalFrom: ['INSERTED', 'PAYING', 'PAID', 'NOTICE_STORED', 'NOTIFIED'] },
  legacyOutcomeOkNoRpt: {
    from: ['PAYING'], logicalFrom: ['PAYING'], state: 'PAID_NORPT', logical: 'PAID', trigger: 'sendPaymentOutcome'
  },
  legacyPaidComplete: {
    from: ['PAID_NORPT'], logicalFrom: ['PAID'], state: 'PAID', trigger: 'NodoInviaRPT'
  },
  legacyGenerateReceipt: {
    from: ['PAID'], logicalFrom: ['PAID'], state: 'NOTICE_GENERATED',
    recipient: 'NOTICE_GENERATED', trigger: 'NodoInviaRPT'
  },
  legacyStoreReceipt: {
    from: ['NOTICE_GENERATED'], logicalFrom: ['PAID'],
    state: 'NOTICE_STORED', logical: 'NOTICE_STORED', trigger: 'NodoInviaRPT'
  },
  outcomeStoreReceipt: {
    from: ['PAYING', 'PAYING_RPT', 'PAYMENT_ACCEPTED', 'PAYMENT_UNKNOWN'], logicalFrom: ['PAYING'],
    states: ['PAID', 'NOTICE_GENERATED', 'NOTICE_STORED'], logicalStates: ['PAID', 'NOTICE_STORED'],
    recipient: 'NOTICE_GENERATED', trigger: 'sendPaymentOutcomeV2'
  },
};
