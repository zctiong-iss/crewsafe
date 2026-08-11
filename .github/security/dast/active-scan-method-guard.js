// ZAP HTTP Sender script. This is a last-line control: ZAP's active scanner
// must never send a mutating request to an approved staging scan origin. The
// Cognito Hosted UI login is a separate Browser Authentication initiator and
// is intentionally not affected by this Active Scanner-only guard.
var HttpSender = Java.type('org.parosproxy.paros.network.HttpSender');
var System = Java.type('java.lang.System');

var allowedHosts = [
  String(System.getenv('DAST_WEB_HOST')),
  String(System.getenv('DAST_BACKEND_HOST'))
];

function sendingRequest(msg, initiator, helper) {
  if (initiator != HttpSender.ACTIVE_SCANNER_INITIATOR) {
    return;
  }

  var request = msg.getRequestHeader();
  var host = String(request.getURI().getHost());
  var method = String(request.getMethod()).toUpperCase();

  if (allowedHosts.indexOf(host) === -1) {
    throw new Error('Blocked Active Scanner request outside approved staging hosts');
  }
  if (method !== 'GET' && method !== 'HEAD') {
    throw new Error('Blocked non-GET/HEAD Active Scanner request');
  }
}

function responseReceived(msg, initiator, helper) {
  // Intentionally empty. This guard only prevents unsafe outbound requests.
}
