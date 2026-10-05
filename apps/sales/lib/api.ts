export const API_URL=process.env.NEXT_PUBLIC_API_URL??'http://localhost:10000';
export const TOKEN_KEY='peebee_sales_token';
export async function request<T>(path:string,options:RequestInit={}):Promise<T>{
  const token=typeof window==='undefined'?null:localStorage.getItem(TOKEN_KEY);
  const res=await fetch(`${API_URL}/v1${path}`,{...options,headers:{...(options.body instanceof FormData?{}:{'Content-Type':'application/json'}),...(token?{Authorization:`Bearer ${token}`} : {}),...options.headers},cache:'no-store'});
  const data=await res.json();if(!res.ok)throw new Error(data.message??({invalid_code:'The recovery code is incorrect.',code_expired:'The recovery code has expired. Request a new one.',no_pending_code:'Request a new recovery code.',too_many_attempts:'Too many attempts. Request a new recovery code.'} as Record<string,string>)[data.error]??(res.status===401?'Please sign in again.':'This request could not be completed.'));
  return data as T;
}
