const fs = require('fs');
const path = require('path');
const fpath = path.join(__dirname, 'vscode-extension', 'nevecode-vscode', 'src', 'chat', 'chatProvider.js');
let c = fs.readFileSync(fpath, 'utf8');
const ls = c.split('\n');
const idx = ls.findIndex(l => l.includes("case 'pick_file':"));
console.log('First pick_file at line:', idx + 1);

// Check if already patched
if (ls[idx - 1] && ls[idx - 1].includes('pick_suggested_file')) {
  console.log('Already patched, skipping.');
  process.exit(0);
}

const insert = [
  "        case 'pick_suggested_file': {",
  "          if (msg.path) {",
  "            let content = '';",
  "            try {",
  "              const uri = vscode.Uri.file(msg.path);",
  "              const bytes = await vscode.workspace.fs.readFile(uri);",
  "              content = Buffer.from(bytes).toString('utf8');",
  "              if (content.length > 20000) content = content.slice(0, 20000) + '\\n... (truncado)';",
  "            } catch {}",
  "            webview.postMessage({ type: 'file_suggested', name: msg.name, path: msg.path, content });",
  "          }",
  "          break;",
  "        }",
];
ls.splice(idx, 0, ...insert);
fs.writeFileSync(fpath, ls.join('\n'), 'utf8');
console.log('Done - inserted', insert.length, 'lines at', idx + 1);
