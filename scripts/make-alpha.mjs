// Turn an opaque portrait on a plain background into a real transparent PNG (alpha channel),
// so we can prove the alpha-mask code path works on an unrelated image.
import fs from "node:fs"; import { PNG } from "pngjs";
import { computeMask } from "./.sampleFace.mjs";
const [,, inp, outp] = process.argv;
const img = PNG.sync.read(fs.readFileSync(inp));
const { mask } = computeMask(img.data, img.width, img.height);
const out = new PNG({ width: img.width, height: img.height });
for (let i = 0; i < img.width * img.height; i++) {
  out.data[i*4] = img.data[i*4]; out.data[i*4+1] = img.data[i*4+1]; out.data[i*4+2] = img.data[i*4+2];
  out.data[i*4+3] = mask[i] ? 255 : 0;
}
fs.writeFileSync(outp, PNG.sync.write(out));
console.log("wrote", outp, "opaque px:", mask.reduce((a,b)=>a+b,0));
