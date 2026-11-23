// Export the existing vector logo exactly; no user photographs are processed.
const fs=require('node:fs');
const path=require('node:path');
const {Resvg}=require('@resvg/resvg-js');
const root=path.join(__dirname,'..');
const svg=fs.readFileSync(path.join(root,'icon.svg'));
for(const [name,size] of [['apple-touch-icon.png',180],['icon-192.png',192],['icon-512.png',512]]){
  const image=new Resvg(svg,{fitTo:{mode:'width',value:size}}).render().asPng();
  fs.writeFileSync(path.join(root,name),image);
}
