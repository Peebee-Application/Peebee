"use client";
import { ActivationPage } from '@peebee/shared/activation';
import { API_URL,TOKEN_KEY } from '../../lib/api';
export default function Activate(){return <ActivationPage apiUrl={API_URL} accountType="agent" onActivated={token=>localStorage.setItem(TOKEN_KEY,token)}/>;}
