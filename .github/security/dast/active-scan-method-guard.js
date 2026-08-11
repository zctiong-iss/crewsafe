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
    // HTTP Sender hooks cannot cancel a request without raising a script error,
    // which makes the Automation Framework fail the whole plan. Rewrite unsafe
    // active-scan probes to a bodyless HEAD request instead; the target never
    // receives the original mutating method or payload.
    request.setMethod('HEAD');
    request.setHeader('Content-Length', null);
    request.setHeader('Transfer-Encoding', null);
    request.setHeader('Content-Type', null);
    msg.setRequestBody('');
  }
}

function responseReceived(msg, initiator, helper) {
  // Intentionally empty. This guard only prevents unsafe outbound requests.
}
