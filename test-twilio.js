require('dotenv').config();
const twilio = require('twilio');

console.log('🔍 Testing Twilio configuration...');

const {
  TWILIO_ACCOUNT_SID,
  TWILIO_AUTH_TOKEN,
  TWILIO_VERIFY_SERVICE_SID
} = process.env;

console.log('Account SID:', TWILIO_ACCOUNT_SID ? `${TWILIO_ACCOUNT_SID.substring(0, 10)}...` : 'NOT SET');
console.log('Auth Token:', TWILIO_AUTH_TOKEN ? `${TWILIO_AUTH_TOKEN.substring(0, 10)}...` : 'NOT SET');
console.log('Verify Service SID:', TWILIO_VERIFY_SERVICE_SID ? `${TWILIO_VERIFY_SERVICE_SID.substring(0, 10)}...` : 'NOT SET');

if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_VERIFY_SERVICE_SID) {
  console.error('❌ Missing Twilio configuration');
  process.exit(1);
}

const client = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);

async function testTwilio() {
  try {
    // Test account
    const account = await client.api.accounts(TWILIO_ACCOUNT_SID).fetch();
    console.log('✅ Account OK:', account.friendlyName, account.status);

    // Test verify service
    const service = await client.verify.v2.services(TWILIO_VERIFY_SERVICE_SID).fetch();
    console.log('✅ Verify Service OK:', service.friendlyName);

    console.log('🎉 Twilio configuration is working!');
  } catch (error) {
    console.error('❌ Twilio test failed:', error.message);
    console.error('Error code:', error.code);
    console.error('Error status:', error.status);
  }
}

testTwilio();