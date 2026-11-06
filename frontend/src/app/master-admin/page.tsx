'use client';

import { useState } from 'react';
import Link from 'next/link';
import axios from 'axios';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import {
  Shield,
  KeyRound,
  CheckCircle2,
  Copy,
  Store,
  RefreshCw,
  Eye,
  EyeOff,
  ArrowRight,
} from 'lucide-react';
import toast from 'react-hot-toast';

interface InitializedOwnerData {
  id: string;
  name: string;
  store_name: string;
  email: string;
  role: string;
  initialCredentials: {
    email: string;
    password: string;
    master_pin: string;
    owner_approval_pin: string;
  };
}

export default function MasterAdminPage() {
  const [secretKey, setSecretKey] = useState('');
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [checkingAuth, setCheckingAuth] = useState(false);

  // Form fields
  const [ownerName, setOwnerName] = useState('');
  const [storeName, setStoreName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [masterPin, setMasterPin] = useState('');
  const [approvalPin, setApprovalPin] = useState('');
  const [country, setCountry] = useState('US');
  const [phone, setPhone] = useState('');

  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [createdOwner, setCreatedOwner] = useState<InitializedOwnerData | null>(null);

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!secretKey.trim()) return;
    setCheckingAuth(true);
    try {
      await axios.get('/api/master-admin/status', {
        headers: { 'X-Master-Admin-Key': secretKey.trim() },
      });
      setIsAuthenticated(true);
      toast.success('Master Admin authenticated successfully');
    } catch (err: unknown) {
      const msg = axios.isAxiosError(err)
        ? (err.response?.data as { error?: string })?.error || 'Authentication failed'
        : 'Invalid Secret Key';
      toast.error(msg);
    } finally {
      setCheckingAuth(false);
    }
  };

  const handleGenerateCredentials = () => {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$%';
    let autoPass = '';
    for (let i = 0; i < 12; i++) {
      autoPass += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    const autoMasterPin = Math.floor(1000 + Math.random() * 9000).toString();
    const autoApprovalPin = Math.floor(1000 + Math.random() * 9000).toString();

    setPassword(autoPass);
    setMasterPin(autoMasterPin);
    setApprovalPin(autoApprovalPin);
    toast.success('Generated strong credentials');
  };

  const handleInitializeOwner = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ownerName || !storeName || !email || !password || !masterPin) {
      toast.error('Please fill in all required fields');
      return;
    }

    setSubmitting(true);
    try {
      const res = await axios.post(
        '/api/master-admin/initialize-owner',
        {
          name: ownerName,
          store_name: storeName,
          email,
          password,
          master_pin: masterPin,
          owner_approval_pin: approvalPin || masterPin,
          country,
          phone: phone || undefined,
        },
        {
          headers: { 'X-Master-Admin-Key': secretKey.trim() },
        },
      );

      setCreatedOwner(res.data.owner);
      toast.success(res.data.message || 'Store Owner Initialized Successfully');
    } catch (err: unknown) {
      const msg = axios.isAxiosError(err)
        ? (err.response?.data as { error?: string })?.error || 'Failed to initialize store owner'
        : 'Initialization error';
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  };

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    toast.success(`${label} copied to clipboard`);
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-2xl space-y-6">
        <div className="text-center space-y-2">
          <div className="inline-flex p-3 bg-red-950/60 border border-red-800/40 rounded-2xl mb-2 text-red-400">
            <Shield className="w-8 h-8" />
          </div>
          <h1 className="text-3xl font-extrabold tracking-tight">Master Admin Portal</h1>
          <p className="text-slate-400 text-sm">
            Autonomous External Store Provisioning & Owner Account Management
          </p>
        </div>

        {!isAuthenticated ? (
          <Card className="bg-slate-900 border-slate-800 text-slate-100 shadow-xl">
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <KeyRound className="w-5 h-5 text-amber-500" />
                Authenticate Master Admin
              </CardTitle>
              <CardDescription className="text-slate-400">
                Enter your Master Admin Secret Key or Environment Access Token to manage stores.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleAuth} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="master-secret">Master Admin Secret Key</Label>
                  <Input
                    id="master-secret"
                    type="password"
                    placeholder="Enter Secret Key or MASTER_ADMIN_SECRET_KEY"
                    value={secretKey}
                    onChange={(e) => setSecretKey(e.target.value)}
                    className="bg-slate-950 border-slate-800 text-slate-100"
                    required
                  />
                </div>
                <Button
                  type="submit"
                  disabled={checkingAuth || !secretKey.trim()}
                  className="w-full bg-red-600 hover:bg-red-700 text-white font-medium"
                >
                  {checkingAuth ? 'Verifying Credentials...' : 'Unlock Portal'}
                </Button>
              </form>
            </CardContent>
          </Card>
        ) : createdOwner ? (
          <Card className="bg-slate-900 border-emerald-900/50 text-slate-100 shadow-xl">
            <CardHeader className="border-b border-slate-800 pb-4">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-full bg-emerald-950 text-emerald-400 border border-emerald-800">
                  <CheckCircle2 className="w-6 h-6" />
                </div>
                <div>
                  <CardTitle className="text-xl text-emerald-400">Owner Initialized Successfully</CardTitle>
                  <CardDescription className="text-slate-400">
                    Hand over these initial credentials to the shop owner securely.
                  </CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="pt-6 space-y-6">
              <div className="rounded-lg bg-slate-950 border border-slate-800 p-4 space-y-3 font-mono text-sm">
                <div className="flex justify-between items-center py-1 border-b border-slate-900">
                  <span className="text-slate-400">Store Name:</span>
                  <span className="text-slate-100 font-semibold">{createdOwner.store_name}</span>
                </div>
                <div className="flex justify-between items-center py-1 border-b border-slate-900">
                  <span className="text-slate-400">Owner Name:</span>
                  <span className="text-slate-100 font-semibold">{createdOwner.name}</span>
                </div>
                <div className="flex justify-between items-center py-1 border-b border-slate-900">
                  <span className="text-slate-400">Login Email:</span>
                  <span className="text-amber-400 font-semibold">{createdOwner.initialCredentials.email}</span>
                </div>
                <div className="flex justify-between items-center py-1 border-b border-slate-900">
                  <span className="text-slate-400">Initial Password:</span>
                  <span className="text-emerald-400 font-semibold">{createdOwner.initialCredentials.password}</span>
                </div>
                <div className="flex justify-between items-center py-1 border-b border-slate-900">
                  <span className="text-slate-400">Database Master PIN:</span>
                  <span className="text-indigo-400 font-semibold">{createdOwner.initialCredentials.master_pin}</span>
                </div>
                <div className="flex justify-between items-center py-1">
                  <span className="text-slate-400">Owner Approval PIN:</span>
                  <span className="text-indigo-400 font-semibold">{createdOwner.initialCredentials.owner_approval_pin}</span>
                </div>
              </div>

              <div className="flex flex-col sm:flex-row gap-3">
                <Button
                  type="button"
                  onClick={() =>
                    copyToClipboard(
                      `Store Name: ${createdOwner.store_name}\nOwner: ${createdOwner.name}\nEmail: ${createdOwner.initialCredentials.email}\nPassword: ${createdOwner.initialCredentials.password}\nMaster PIN: ${createdOwner.initialCredentials.master_pin}\nApproval PIN: ${createdOwner.initialCredentials.owner_approval_pin}`,
                      'Handover Credentials',
                    )
                  }
                  className="flex-1 gap-2 bg-emerald-600 hover:bg-emerald-700 text-white"
                >
                  <Copy className="w-4 h-4" />
                  Copy Handover Summary
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setCreatedOwner(null);
                    setOwnerName('');
                    setStoreName('');
                    setEmail('');
                    setPassword('');
                    setMasterPin('');
                    setApprovalPin('');
                  }}
                  className="border-slate-700 hover:bg-slate-800 text-slate-200"
                >
                  Initialize Another Store
                </Button>
              </div>

              <div className="pt-2">
                <Link
                  href="/auth/login"
                  className="inline-flex items-center text-sm text-slate-400 hover:text-slate-200 underline gap-1"
                >
                  Proceed to Login with newly created Owner <ArrowRight className="w-4 h-4" />
                </Link>
              </div>
            </CardContent>
          </Card>
        ) : (
          <Card className="bg-slate-900 border-slate-800 text-slate-100 shadow-xl">
            <CardHeader className="border-b border-slate-800 pb-4">
              <div className="flex justify-between items-center">
                <div>
                  <CardTitle className="text-lg flex items-center gap-2">
                    <Store className="w-5 h-5 text-red-500" />
                    Initialize New Store Owner
                  </CardTitle>
                  <CardDescription className="text-slate-400">
                    Creates the store profile and owner credentials directly in the database.
                  </CardDescription>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleGenerateCredentials}
                  className="gap-1.5 border-slate-700 hover:bg-slate-800 text-xs"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  Auto-Gen Credentials
                </Button>
              </div>
            </CardHeader>
            <CardContent className="pt-6">
              <form onSubmit={handleInitializeOwner} className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="store-name">Store Name *</Label>
                    <Input
                      id="store-name"
                      placeholder="e.g. Cafe Flo Downtown"
                      value={storeName}
                      onChange={(e) => setStoreName(e.target.value)}
                      className="bg-slate-950 border-slate-800 text-slate-100"
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="owner-name">Owner Full Name *</Label>
                    <Input
                      id="owner-name"
                      placeholder="e.g. Alex Morgan"
                      value={ownerName}
                      onChange={(e) => setOwnerName(e.target.value)}
                      className="bg-slate-950 border-slate-800 text-slate-100"
                      required
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="owner-email">Owner Email *</Label>
                  <Input
                    id="owner-email"
                    type="email"
                    placeholder="owner@domain.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="bg-slate-950 border-slate-800 text-slate-100"
                    required
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="owner-password">Password (min 4 characters) *</Label>
                  <div className="relative">
                    <Input
                      id="owner-password"
                      type={showPassword ? 'text' : 'password'}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="Set or auto-generate strong password"
                      className="bg-slate-950 border-slate-800 text-slate-100 pe-10"
                      required
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute end-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
                    >
                      {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="master-pin">Database Master PIN (4 digits) *</Label>
                    <Input
                      id="master-pin"
                      maxLength={4}
                      value={masterPin}
                      onChange={(e) => setMasterPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
                      placeholder="e.g. 1234"
                      className="bg-slate-950 border-slate-800 text-slate-100 tracking-widest text-center"
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="approval-pin">Owner Approval PIN (4-6 digits)</Label>
                    <Input
                      id="approval-pin"
                      maxLength={6}
                      value={approvalPin}
                      onChange={(e) => setApprovalPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
                      placeholder="Defaults to Master PIN"
                      className="bg-slate-950 border-slate-800 text-slate-100 tracking-widest text-center"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="country">Country Code</Label>
                    <Input
                      id="country"
                      maxLength={2}
                      value={country}
                      onChange={(e) => setCountry(e.target.value.toUpperCase().slice(0, 2))}
                      placeholder="US"
                      className="bg-slate-950 border-slate-800 text-slate-100"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="phone">Phone (Optional)</Label>
                    <Input
                      id="phone"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      placeholder="+15551234567"
                      className="bg-slate-950 border-slate-800 text-slate-100"
                    />
                  </div>
                </div>

                <Button
                  type="submit"
                  disabled={submitting}
                  className="w-full bg-red-600 hover:bg-red-700 text-white font-semibold py-2.5 mt-2"
                >
                  {submitting ? 'Initializing Store Owner...' : 'Initialize Store Owner'}
                </Button>
              </form>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
