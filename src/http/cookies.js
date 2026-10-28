export function cookieSettings(isProduction) {
  return {
    sessionName: isProduction ? '__Host-nicolabz_sid' : 'nicolabz_sid',
    flowName: isProduction ? '__Host-nicolabz_flow' : 'nicolabz_flow',
    default: { httpOnly: true, secure: isProduction, sameSite: 'lax', path: '/' }
  };
}

export function setSessionCookie(reply, settings, token, durationMs) {
  reply.setCookie(settings.sessionName, token, {
    ...settings.default, maxAge: Math.floor(durationMs / 1000)
  });
}

export function clearSessionCookie(reply, settings) {
  reply.clearCookie(settings.sessionName, settings.default);
}

export function setFlowCookie(reply, settings, browserToken) {
  reply.setCookie(settings.flowName, browserToken, {
    ...settings.default, maxAge: 10 * 60
  });
}

export function clearFlowCookie(reply, settings) {
  reply.clearCookie(settings.flowName, settings.default);
}
