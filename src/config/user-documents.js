/**
 * Catalogue of the document "slots" a consultant is expected to provide.
 *
 * The admin creates a user WITHOUT documents; the FE renders this fixed list so the
 * consultant sees exactly which documents to upload after logging in. Adding a new
 * expected document is a one-line change here.
 *
 * `required` drives the "profile complete" nudge; `appliesTo` lets us show the right
 * documents per consultant type (e.g. work authorization only for visa holders) —
 * an empty array means it applies to everyone.
 */
const USER_DOCUMENT_TYPES = Object.freeze({
  OFFER_LETTER: 'offer_letter',
  ID_PROOF: 'id_proof',
  WORK_AUTHORIZATION: 'work_authorization',
  RESUME: 'resume',
  EDUCATION_CERTIFICATE: 'education_certificate',
  BANK_DETAILS: 'bank_details',
  OTHER: 'other',
});

/** Ordered slots the UI renders as the default "documents to provide" list. */
const USER_DOCUMENT_CATALOGUE = Object.freeze([
  { type: USER_DOCUMENT_TYPES.OFFER_LETTER, label: 'Offer Letter', required: false, appliesTo: [] },
  { type: USER_DOCUMENT_TYPES.ID_PROOF, label: 'ID Proof', required: true, appliesTo: [] },
  {
    type: USER_DOCUMENT_TYPES.WORK_AUTHORIZATION,
    label: 'Work Authorization',
    required: false,
    appliesTo: [],
  },
  { type: USER_DOCUMENT_TYPES.RESUME, label: 'Resume / CV', required: false, appliesTo: [] },
  {
    type: USER_DOCUMENT_TYPES.EDUCATION_CERTIFICATE,
    label: 'Education Certificate',
    required: false,
    appliesTo: [],
  },
  {
    type: USER_DOCUMENT_TYPES.BANK_DETAILS,
    label: 'Bank Details',
    required: false,
    appliesTo: [],
  },
]);

const USER_DOCUMENT_TYPE_KEYS = Object.freeze(Object.values(USER_DOCUMENT_TYPES));

module.exports = {
  USER_DOCUMENT_TYPES,
  USER_DOCUMENT_CATALOGUE,
  USER_DOCUMENT_TYPE_KEYS,
};
