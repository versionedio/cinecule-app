import { useEffect, useRef, useState } from "react";
import { Camera } from "lucide-react";
import { getMyProfile, updateProfile, changePassword } from "../services/authService";
import { uploadEntityFile } from "../services/uploadService";
import { useAuth } from "../hooks/useAuth";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Alert } from "@/components/ui/alert";

export default function ProfilePage() {
  const { profile, setProfile } = useAuth();
  const [fn, setFn] = useState("");
  const [ln, setLn] = useState("");
  const [avatarUrl, setAvatarUrl] = useState<string | undefined>();
  const [currentPwd, setCurrentPwd] = useState("");
  const [newPwd, setNewPwd] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    getMyProfile()
      .then((p) => {
        setProfile(p);
        setFn(p.fn ?? "");
        setLn(p.ln ?? "");
        setAvatarUrl(p.picurl || p.picture);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Couldn't load profile."));
  }, []);

  const saveName = async () => {
    setError("");
    setNotice("");
    try {
      await updateProfile({ fn, ln });
      setNotice("Profile saved.");
      setProfile({ ...profile, fn, ln });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed.");
    }
  };

  const onPickImage = async (file: File) => {
    setError("");
    setNotice("");
    try {
      const { s3Key, cdnUrl } = await uploadEntityFile("user", "picture", file);
      // Platform bug workaround: the API expects `picurl`, not the documented `picture`.
      await updateProfile({ picurl: s3Key });
      setAvatarUrl(cdnUrl);
      setNotice("Profile photo updated.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Photo upload failed.");
    }
  };

  const savePassword = async () => {
    setError("");
    setNotice("");
    try {
      await changePassword(currentPwd, newPwd);
      setCurrentPwd("");
      setNewPwd("");
      setNotice("Password changed.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Password change failed.");
    }
  };

  const initials = fn ? `${fn[0]}${ln?.[0] ?? ""}` : profile?.email?.[0]?.toUpperCase();

  return (
    <div className="max-w-[560px]">
      <h1 className="mb-6 font-display text-2xl font-semibold">Profile</h1>
      {notice && <Alert severity="success" className="mb-4">{notice}</Alert>}
      {error && <Alert severity="error" className="mb-4">{error}</Alert>}

      <Card className="p-6">
        <div className="mb-6 flex items-center gap-4">
          <Avatar className="h-16 w-16">
            <AvatarImage src={avatarUrl} />
            <AvatarFallback>{initials}</AvatarFallback>
          </Avatar>
          <Button variant="outline" size="sm" onClick={() => fileInput.current?.click()}>
            <Camera className="h-4 w-4" />
            Change photo
          </Button>
          <input
            ref={fileInput}
            type="file"
            accept="image/*"
            hidden
            onChange={(e) => e.target.files?.[0] && onPickImage(e.target.files[0])}
          />
        </div>

        <div className="flex flex-col gap-4">
          <div className="flex gap-3">
            <Field label="First name">
              <Input value={fn} onChange={(e) => setFn(e.target.value)} />
            </Field>
            <Field label="Last name">
              <Input value={ln} onChange={(e) => setLn(e.target.value)} />
            </Field>
          </div>
          <Field label="Email">
            <Input value={profile?.email ?? ""} disabled />
          </Field>
          <div>
            <Button onClick={saveName}>Save changes</Button>
          </div>
        </div>

        <div className="hr my-6" />

        <h2 className="mb-4 font-display text-base font-semibold">Change password</h2>
        <div className="flex flex-col gap-4">
          <Field label="Current password">
            <Input type="password" value={currentPwd} onChange={(e) => setCurrentPwd(e.target.value)} />
          </Field>
          <Field label="New password">
            <Input type="password" value={newPwd} onChange={(e) => setNewPwd(e.target.value)} />
          </Field>
          <div>
            <Button variant="outline" disabled={!currentPwd || !newPwd} onClick={savePassword}>
              Change password
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}
