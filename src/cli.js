// Uso: npm run cli -- list | invite [--rotate] | approve "Nombre" | admin "Nombre" | link "Nombre"
const { openDb } = require('./db');
const { createModel } = require('./model');

const model = createModel(openDb());
const origin = process.env.ORIGIN || `http://localhost:${process.env.PORT || 3000}`;
const [cmd, arg] = process.argv.slice(2);
const die = (msg) => { console.error(msg); process.exit(1); };
const byName = (n) => model.members().find((m) => m.name.toLowerCase() === String(n).toLowerCase()) || die(`No existe "${n}"`);

switch (cmd) {
  case 'list': for (const m of model.members()) console.log(`${m.id}\t${m.name}\t${m.status}${m.is_admin ? '\tadmin' : ''}\t${m.devices} disp.`); break;
  case 'invite': console.log(`${origin}/registro?i=${arg === '--rotate' ? model.rotateInvite() : model.invite()}`); break;
  case 'approve': model.approve(byName(arg).id); console.log('OK'); break;
  case 'admin': model.setAdmin(byName(arg).id, true); console.log('OK'); break;
  case 'link': console.log(`${origin}/vincular/${model.createLink(byName(arg).id)}`); break;
  default: die('Uso: list | invite [--rotate] | approve "Nombre" | admin "Nombre" | link "Nombre"');
}
