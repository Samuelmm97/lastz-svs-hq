// Isolated browser QA: real frontend + Worker validation, in-memory saves only.
const http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const P=require('./placement-planner.js');
const read=file=>JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''));
async function startServer(port=0) {
  const {draftFitsPlan}=await import('./backend/worker.js');
  const plan=read(process.env.QA_PLAN||path.join(__dirname,'placement-plan.json'));
  const initial=process.env.QA_SHARED?read(process.env.QA_SHARED):{revision:1,draft:P.exportDraft(P.create(plan))};
  let shared={...initial,updatedBy:'QA fixture'},saves=0;
  const history=new Map([[shared.revision,structuredClone(shared)]]);
  const server=http.createServer(async(req,res)=>{
    const url=new URL(req.url,'http://localhost');
    const json=(body,status=200)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(body));};
    if(url.pathname==='/placement-config.js'){res.setHeader('Content-Type','text/javascript');res.end('window.PLACEMENT_API_URL = location.origin;');return;}
    if(url.pathname==='/placement-plan.json'){json(plan);return;}
    if(url.pathname.startsWith('/api/')) {
      if(url.pathname==='/api/editor-check'){json({},req.headers.authorization==='Bearer local-test-key'?200:401);return;}
      if(url.pathname==='/api/placement/alliance-roster'){
        json(process.env.QA_ALLIANCE_ROSTER?read(process.env.QA_ALLIANCE_ROSTER):{state:798,source:{observedAt:'2026-10-22T00:08:23Z'},alliances:[{tag:'FZTA',name:'Test alliance',members:1}],players:[{uid:'1000000001',tag:'FZTA'}]});return;
      }
      if(url.pathname==='/api/placement/plan'){json({plan});return;}
      if(url.pathname==='/api/placement/history'){json({entries:[...history.values()].reverse().map(s=>({...s,draft:undefined,changes:{}}))});return;}
      if(url.pathname.startsWith('/api/placement/history/')){json({...history.get(Number(url.pathname.split('/').pop())),plan});return;}
      if(req.method==='GET'){json(shared);return;}
      if(req.headers.authorization!=='Bearer local-test-key'){json({error:'Editor key rejected'},401);return;}
      let body='';for await(const chunk of req)body+=chunk;
      try {
        const data=JSON.parse(body);
        if(data.baseRevision!==shared.revision){json({error:'Revision conflict'},409);return;}
        if(!draftFitsPlan(data.draft,plan)){json({error:'Draft does not fit plan'},400);return;}
        shared={revision:shared.revision+1,draft:data.draft,updatedBy:data.editor,updatedAt:new Date().toISOString()};
        saves++;history.set(shared.revision,structuredClone(shared));json(shared);
      }catch(e){json({error:e.message},400);}return;
    }
    const name=path.resolve(__dirname,'.'+decodeURIComponent(url.pathname==='/'?'/placement.html':url.pathname));
    if(!name.startsWith(__dirname+path.sep)){res.writeHead(404);res.end();return;}
    try {const ext=path.extname(name);res.setHeader('Content-Type',({'.js':'text/javascript','.html':'text/html','.css':'text/css','.json':'application/json'})[ext]||'application/octet-stream');res.end(fs.readFileSync(name));}
    catch {res.writeHead(404);res.end();}
  });
  await new Promise(resolve=>server.listen(port,'127.0.0.1',resolve));
  return {server,plan,get shared(){return shared;},get saves(){return saves;},url:`http://127.0.0.1:${server.address().port}`};
}
module.exports={startServer};
if(require.main===module)startServer(8765).then(s=>console.log('Isolated QA planner: '+s.url));
