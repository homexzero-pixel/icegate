// Reference names used to label codes in the dashboard.
'use strict';

const PORTS = {
  INNSA1: 'Nhava Sheva',
  INMUN1: 'Mundra',
  INMAA1: 'Chennai Sea',
  INBOM4: 'Mumbai Air',
  INDEL4: 'Delhi Air',
  INBLR4: 'Bengaluru Air',
  INCCU1: 'Kolkata Sea',
  INPAV1: 'Pipavav',
};

const HS_CHAPTERS = {
  '27': 'Mineral fuels & oils',
  '29': 'Organic chemicals',
  '30': 'Pharmaceuticals',
  '39': 'Plastics',
  '62': 'Apparel (not knitted)',
  '71': 'Gems & jewellery',
  '72': 'Iron & steel',
  '84': 'Machinery',
  '85': 'Electrical equipment',
  '87': 'Vehicles & parts',
};

const COUNTRIES = {
  US: 'United States', AE: 'UAE', GB: 'United Kingdom', DE: 'Germany', NL: 'Netherlands',
  BD: 'Bangladesh', SG: 'Singapore', CN: 'China', SA: 'Saudi Arabia', KR: 'South Korea', JP: 'Japan',
};

// IGST refund validation response codes as reported against shipping bills.
const REFUND_ERRORS = {
  SB002: 'EGM not filed',
  SB003: 'GSTIN mismatch',
  SB005: 'Invoice number mismatch',
  SB006: 'Gateway EGM not available',
};

module.exports = { PORTS, HS_CHAPTERS, COUNTRIES, REFUND_ERRORS };
