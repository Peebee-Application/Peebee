import { request, TOKEN_KEY } from './api';
export type AccessStatus = 'none' | 'pending' | 'approved' | 'rejected' | 'disabled';
export async function finishSignIn(token:string, apply=false) {
  localStorage.setItem(TOKEN_KEY,token);
  try {
    const result=await request<{status:AccessStatus}>(apply?'/sales-access/request':'/sales-access/status',apply?{method:'POST',body:JSON.stringify({consent:true})}:{});
    window.location.replace(result.status==='approved'?'/':'/approval');
  } catch(error) {localStorage.removeItem(TOKEN_KEY);throw error;}
}
