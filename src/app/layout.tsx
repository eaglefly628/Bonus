import type { Metadata, Viewport } from 'next';
import './styles.css';
export const metadata: Metadata = { title:'ActionPoints', description:'家庭行动积分', manifest:'/manifest.webmanifest', appleWebApp:{capable:true,title:'ActionPoints'} };
export const viewport: Viewport = { width:'device-width',initialScale:1,themeColor:'#f5f3ed' };
export default function RootLayout({children}:{children:React.ReactNode}) { return <html lang="zh-CN"><body>{children}</body></html>; }
