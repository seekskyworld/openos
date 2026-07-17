import { validateArtifact, hasFatal } from "../src/gen-apps/artifact-validator.js";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

const syntaxBad = `<!DOCTYPE html><html><body><button>x</button>
<script>function calc() { retrun a + b; }</script></body></html>`;
const r1 = validateArtifact(syntaxBad);
assert(r1.some((i) => i.code === "js_syntax_error" && i.severity === "fatal"), "expect js_syntax_error");

const noBind = `<!DOCTYPE html><html><head><meta name="viewport" content="w"></head>
<body><button>A</button><button>B</button><input /><script>const x=1;</script></body></html>`;
const r2 = validateArtifact(noBind);
assert(r2.some((i) => i.code === "no_event_binding"), "expect no_event_binding");

const external = `<!DOCTYPE html><html><body><button id="b">go</button>
<script>
document.getElementById('b').addEventListener('click',()=>fetch('https://evil.example'));
</script></body></html>`;
const r3 = validateArtifact(external);
assert(r3.some((i) => i.code === "external_resource"), "expect external_resource");

const ls = `<!DOCTYPE html><html><body><button id="b">s</button>
<script>
document.getElementById('b').addEventListener('click',()=>{localStorage.setItem('k',1)});
</script></body></html>`;
const r4 = validateArtifact(ls);
assert(r4.some((i) => i.code === "uses_localstorage" && i.severity === "warning"), "expect uses_localstorage warn");

const good = `<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">
<style>body{font:14px system-ui}</style></head>
<body>
  <h1>Calc</h1>
  <input id="a" type="number" value="1" />
  <input id="b" type="number" value="2" />
  <button id="add">+</button>
  <div id="out"></div>
  <script>
    document.getElementById('add').addEventListener('click', function () {
      var a = Number(document.getElementById('a').value);
      var b = Number(document.getElementById('b').value);
      document.getElementById('out').textContent = String(a + b);
    });
  </script>
</body></html>`;
const r5 = validateArtifact(good);
assert(r5.filter((i) => i.severity === "fatal").length === 0, "good fixture must have no fatal: " + JSON.stringify(r5));
assert(!hasFatal(r5), "hasFatal false");

console.log("smoke-artifact-validator: PASS");
console.log({
  syntax: r1.map((i) => i.code),
  noBind: r2.map((i) => i.code),
  external: r3.map((i) => i.code),
  ls: r4.map((i) => i.code),
  good: r5.map((i) => i.code),
});
