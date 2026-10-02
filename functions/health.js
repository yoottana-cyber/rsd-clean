export async function onRequest({ request, env }) {
  const headers = {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer"
  };
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response(JSON.stringify({ ok:false, error:"METHOD_NOT_ALLOWED" }), {
      status:405,
      headers:{...headers,Allow:"GET, HEAD"}
    });
  }
  const started=Date.now();
  let dbOk=false,message="ok";
  try{
    if(!env.DB)throw Error("DB binding missing");
    const row=await env.DB.prepare("SELECT 1 ok").first();
    dbOk=Number(row?.ok||0)===1;
    if(!dbOk)message="D1 check failed";
  }catch(e){
    message=String(e?.message||e).slice(0,160);
  }
  const body={
    ok:dbOk,
    service:"RSD Clean",
    db:dbOk?"ok":"error",
    time:new Date().toISOString(),
    responseMs:Date.now()-started
  };
  if(!dbOk)body.message=message;
  if(request.method==="HEAD")return new Response(null,{status:dbOk?200:503,headers});
  return new Response(JSON.stringify(body),{status:dbOk?200:503,headers});
}
