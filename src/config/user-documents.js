/**
 * Catalogue of the document "slots" a consultant is expected to provide.
 *
 * The admin creates a user WITHOUT documents; the FE renders this fixed list so the
 * consultant sees exactly which documents to upload after logging in. Adding a new
 * expected document is a one-line change here.
 *
 * PER-SLOT METADATA:
 *  - `required`   drives the "profile complete" nudge.
 *  - `appliesTo`  scopes a slot to specific employee types (e.g. the 1099 contract
 *                 only shows for 1099 consultants). An empty array = applies to
 *                 everyone. Values match UserProfile.employee_type ('w2','1099','c2c',...).
 *  - `sampleUrl`  optional link to a blank sample the user can download, fill, and
 *                 re-upload (e.g. the W-4 form). Served as a static FE asset.
 *  - `visaOnly`   when true, the slot is only expected for time-bound visa statuses
 *                 (hidden for U.S. Citizens / Green Card holders). Used for the work
 *                 authorization document.
 */
const USER_DOCUMENT_TYPES = Object.freeze({
  OFFER_LETTER: 'offer_letter',
  ID_PROOF: 'id_proof',
  STATE_ISSUED_ID: 'state_issued_id',
  WORK_AUTHORIZATION: 'work_authorization',
  W4_FORM: 'w4_form',
  E_VERIFY: 'e_verify',
  RESUME: 'resume',
  EDUCATION_CERTIFICATE: 'education_certificate',
  BANK_DETAILS: 'bank_details',
  PURCHASE_ORDER: 'purchase_order',
  CONTRACT_1099: 'contract_1099',
  OTHER: 'other',
});

/** Ordered slots the UI renders as the default "documents to provide" list. */
const USER_DOCUMENT_CATALOGUE = Object.freeze([
  {
    type: USER_DOCUMENT_TYPES.OFFER_LETTER,
    label: 'Offer Letter',
    required: false,
    appliesTo: [],
  },
  {
    type: USER_DOCUMENT_TYPES.ID_PROOF,
    label: 'ID Proof',
    required: true,
    appliesTo: [],
  },
  {
    type: USER_DOCUMENT_TYPES.STATE_ISSUED_ID,
    label: 'State Issued ID',
    required: false,
    appliesTo: [],
  },
  {
    type: USER_DOCUMENT_TYPES.WORK_AUTHORIZATION,
    label: 'Visa / Work Authorization Document / EAD',
    required: false,
    appliesTo: [],
    visaOnly: true,
  },
  {
    type: USER_DOCUMENT_TYPES.W4_FORM,
    label: 'W-4 Form',
    required: false,
    appliesTo: ['w2', 'employee'],
    sampleUrl: '/assets/samples/w4-form-sample.pdf',
  },
  {
    type: USER_DOCUMENT_TYPES.E_VERIFY,
    label: 'E-Verify',
    required: false,
    appliesTo: [],
  },
  {
    type: USER_DOCUMENT_TYPES.RESUME,
    label: 'Resume / CV',
    required: false,
    appliesTo: [],
  },
  {
    type: USER_DOCUMENT_TYPES.EDUCATION_CERTIFICATE,
    label: 'Education Certificate',
    required: false,
    appliesTo: [],
  },
  {
    type: USER_DOCUMENT_TYPES.BANK_DETAILS,
    label: 'Cheque / Bank Document',
    required: false,
    appliesTo: [],
  },
  {
    type: USER_DOCUMENT_TYPES.PURCHASE_ORDER,
    label: 'Purchase Order',
    required: false,
    appliesTo: ['c2c'],
  },
  {
    type: USER_DOCUMENT_TYPES.CONTRACT_1099,
    label: '1099 Contract',
    required: false,
    appliesTo: ['1099'],
  },
]);

const USER_DOCUMENT_TYPE_KEYS = Object.freeze(Object.values(USER_DOCUMENT_TYPES));

/**
 * Filter the catalogue for a given employee type. A slot with an empty `appliesTo`
 * is universal; otherwise it only shows when the employee type is listed. Slots with
 * no employee type context (null) get the universal set only.
 */
const catalogueForEmployeeType = (employeeType) =>
  USER_DOCUMENT_CATALOGUE.filter(
    (d) => !d.appliesTo || d.appliesTo.length === 0 || d.appliesTo.includes(employeeType)
  );

module.exports = {
  USER_DOCUMENT_TYPES,
  USER_DOCUMENT_CATALOGUE,
  USER_DOCUMENT_TYPE_KEYS,
  catalogueForEmployeeType,
};
