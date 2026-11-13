// Uso: npm run cli -- add "Nombre" [--admin] | import archivo.txt | list | reset "Nombre"
const fs = require('node:fs');
const { openDb } = require('./db');
const { createModel } = require('./model');

const model = createModel(openDb());
const [cmd, arg, flag] = process.argv.slice(2);
const byName = (n) => model.members().find((m) => m.name.toLowerCase() === String(n).toLowerCase()) || die(`No existe "${n}"`);
function die(msg) { console.error(msg); process.exit(1); }

switch (cmd) {
  case 'add': model.addMember(arg, flag === '--admin'); console.log('OK'); break;
  case 'import':
    for (const n of fs.readFileSync(arg, 'utf8').split('\n').map((s) => s.trim()).filter(Boolean)) {
      try { model.addMember(n); console.log('+', n); } catch (e) { console.log('!', e.message); }
    }
    break;
  case 'list': for (const m of model.members()) console.log(`${m.id}\t${m.name}${m.is_admin ? '\t[admin]' : ''}${m.claimed ? '' : '\t(sin PIN)'}`); break;
  case 'reset': model.resetPin(byName(arg).id); console.log('OK'); break;
  case 'admin': model.setAdmin(byName(arg).id, true); console.log('OK'); break;
  default: die('Uso: add "Nombre" [--admin] | import archivo.txt | list | reset "Nombre" | admin "Nombre"');
}
