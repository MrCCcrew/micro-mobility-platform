require('dotenv').config();
const twilio = require('twilio');

function mask(s){ return s ? s.replace(/.(?=.{4})/g, '*') : 'undefined'; }
const { TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_VERIFY_SERVICE_SID } = process.env;

console.log('AC len:', TWILIO_ACCOUNT_SID?.length, mask(TWILIO_ACCOUNT_SID));
console.log('TK len:', TWILIO_AUTH_TOKEN?.length, mask(TWILIO_AUTH_TOKEN));
console.log('VA len:', TWILIO_VERIFY_SERVICE_SID?.length, mask(TWILIO_VERIFY_SERVICE_SID));

if(!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_VERIFY_SERVICE_SID){
  console.error('❌ Missing env vars'); process.exit(1);
}

const client = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);

(async () => {
  try {
    const acc = await client.api.accounts(TWILIO_ACCOUNT_SID).fetch();
    console.log('✅ Auth OK:', acc.friendlyName, acc.status);

    const service = await client.verify.v2.services(TWILIO_VERIFY_SERVICE_SID).fetch();
    console.log('✅ Verify Service OK:', service.friendlyName, service.sid);

    console.log('🎉 Everything consistent.');
  } catch (e) {
    console.error('❌ Self-test failed:', e.status, e.code, e.message, e.moreInfo || '');
  }
})();
