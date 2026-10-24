export const ROLES = ['analista', 'mobilidade', 'infraestrutura'];
export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = ROLES.length;
/** Em dupla não há Analista: as duas equipes de campo dividem a central. */
export const DUO_ROLES = ['mobilidade', 'infraestrutura'];
const ROLE_ACTIONS = {
  analista: ['interact', 'analyze', 'dispatch', 'archive', 'call-tow', 'problem-select'],
  mobilidade: ['interact', 'mobility-hotkey'],
  infraestrutura: ['interact', 'repair-complete'],
};
/** Ações do tablet concedidas às equipes de campo quando a Analista é compartilhada. */
export const SHARED_ANALYST_ACTIONS = ['analyze', 'dispatch', 'archive', 'call-tow', 'problem-select'];
/** 'trio' com os três papéis, 'duo' com Mobilidade + Infraestrutura; null quando a sala não pode iniciar. */
export function teamMode(roles) {
  const unique = new Set(roles);
  if (unique.size !== roles.length) return null;
  if (roles.length === MAX_PLAYERS && ROLES.every(role => unique.has(role))) return 'trio';
  if (roles.length === MIN_PLAYERS && DUO_ROLES.every(role => unique.has(role))) return 'duo';
  return null;
}
export class ProtocolError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}
export const reject = (code, message) => { throw new ProtocolError(code, message); };
const invalid = () => reject('INVALID_MESSAGE', 'Comando inválido. Confira os campos enviados.');
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
function keys(value, allowed) {
  if (!object(value) || Object.keys(value).some(key => !allowed.includes(key))) invalid();
}
function text(value, min, max) {
  if (typeof value !== 'string' || value.trim().length < min || value.length > max || /[\x00-\x1f\x7f]/u.test(value)) invalid();
  return value.trim();
}
const bool = value => { if (typeof value !== 'boolean') invalid(); return value; };
const role = value => { if (!ROLES.includes(value)) invalid(); return value; };
const number = (value, max) => { if (!Number.isFinite(value) || Math.abs(value) > max) invalid(); return value; };
function pose(value) {
  keys(value, ['x', 'z', 'yaw']);
  return { x: number(value.x, 1000), z: number(value.z, 1000), yaw: number(value.yaw, 1e6) };
}
function action(value) {
  if (!object(value)) invalid();
  switch (value.type) {
    case 'interact':
      keys(value, ['type', 'axis', 'pose']);
      keys(value.axis, ['x', 'z']);
      return { type: value.type, axis: { x: number(value.axis.x, 1), z: number(value.axis.z, 1) }, pose: pose(value.pose) };
    case 'mobility-hotkey':
      keys(value, ['type', 'key', 'pose']);
      if (!['Digit1', 'Digit2', 'Digit3', 'Digit4'].includes(value.key)) invalid();
      return { type: value.type, key: value.key, pose: pose(value.pose) };
    case 'dispatch':
      keys(value, ['type', 'team', 'problemId']);
      if (!['infraestrutura', 'mobilidade'].includes(value.team)) invalid();
      return { type: value.type, team: value.team, ...(value.problemId === undefined ? {} : { problemId: text(value.problemId, 1, 128) }) };
    case 'repair-complete':
      keys(value, ['type']); return { type: value.type };
    case 'analyze': case 'archive': case 'call-tow': case 'problem-select':
      keys(value, ['type', 'problemId']);
      return { type: value.type, problemId: value.type === 'problem-select' && value.problemId === null ? null : text(value.problemId, 1, 128) };
    default: invalid();
  }
}
export function validateMessage(value) {
  if (!object(value)) invalid();
  const allowed = {
    'create-room': ['name', 'role', 'isPublic'],
    join: ['code', 'name', 'role'], 'join-open': ['code', 'name', 'role'], 'set-role': ['role'],
    'list-rooms': [], leave: [], start: [], 'tutorial-open': [],
    ready: ['ready'], 'tutorial-ready': ['ready'], 'set-public': ['isPublic'],
    move: ['x', 'z', 'yaw'], action: ['action'], pause: ['paused'],
  };
  if (!Object.hasOwn(allowed, value.type)) reject('UNKNOWN_COMMAND', 'Comando desconhecido.');
  keys(value, ['type', 'requestId', ...allowed[value.type]]);
  const result = { type: value.type };
  if (value.requestId !== undefined) result.requestId = text(value.requestId, 1, 64);
  switch (value.type) {
    case 'create-room':
      Object.assign(result, { name: text(value.name, 1, 24), role: role(value.role), isPublic: bool(value.isPublic) }); break;
    case 'join': case 'join-open': {
      const code = text(value.code, 4, 8).toUpperCase();
      if (!/^[A-Z0-9]{4,8}$/.test(code)) invalid();
      Object.assign(result, { name: text(value.name, 1, 24), role: role(value.role), code }); break;
    }
    case 'set-role': result.role = role(value.role); break;
    case 'ready': case 'tutorial-ready': result.ready = bool(value.ready); break;
    case 'set-public': result.isPublic = bool(value.isPublic); break;
    case 'pause': result.paused = bool(value.paused); break;
    case 'move': Object.assign(result, pose({ x: value.x, z: value.z, yaw: value.yaw })); break;
    case 'action': result.action = action(value.action); break;
  }
  return result;
}
/** Papel principal + permissões extras do modo em dupla. Calculado uma vez, no início da partida. */
export function permissionsFor(actorRole, sharedAnalyst = false) {
  const own = ROLE_ACTIONS[actorRole] ?? [];
  return new Set(sharedAnalyst && DUO_ROLES.includes(actorRole) ? [...own, ...SHARED_ANALYST_ACTIONS] : own);
}
export function authorizeAction(actorRole, action, sharedAnalyst = false) {
  if (!permissionsFor(actorRole, sharedAnalyst).has(action.type)) reject('FORBIDDEN', 'Seu papel não pode executar essa ação.');
}
/**
 * Chave de idempotência das ações da central. Ações com a mesma chave só têm efeito
 * uma vez por partida, então a primeira a chegar vence e as repetidas são absorvidas.
 */
export function analysisKey(action) {
  switch (action.type) {
    case 'analyze': case 'archive': case 'call-tow': return action.type + ':' + action.problemId;
    case 'dispatch': return action.problemId === undefined ? null : 'dispatch:' + action.problemId + ':' + action.team;
    default: return null;
  }
}
