import { useEffect, useRef, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import {
  Mic,
  MicOff,
  Video,
  VideoOff,
  PhoneOff,
  Maximize,
  Minimize,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { motion, AnimatePresence } from 'framer-motion';
import { useLanguage } from '@/context/language-context';
import type { CallState } from '@/hooks/use-webrtc';

export type CallUser = {
  name?: string | null;
  img?: string | null;
  avatar?: string | null;
};

export function VideoCallDialog({
  open,
  onOpenChange,
  user,
  localStream,
  remoteStream,
  callState,
  endCall,
  isMuted,
  isVideoOff,
  onToggleMute,
  onToggleVideo,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  user: CallUser | null;
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
  callState: CallState;
  endCall: () => void;
  isMuted: boolean;
  isVideoOff: boolean;
  onToggleMute: () => void;
  onToggleVideo: () => void;
}) {
  const { t } = useLanguage();
  const [callDuration, setCallDuration] = useState(0);
  const [isFullScreen, setIsFullScreen] = useState(false);
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (localVideoRef.current && localStream) {
      localVideoRef.current.srcObject = localStream;
    }
  }, [localStream]);

  useEffect(() => {
    if (remoteVideoRef.current && remoteStream) {
      remoteVideoRef.current.srcObject = remoteStream;
    }
  }, [remoteStream]);

  useEffect(() => {
    if (!open || callState !== 'connected') {
      return;
    }
    setCallDuration(0);
    const timer = setInterval(() => {
      setCallDuration((prev) => prev + 1);
    }, 1000);
    return () => clearInterval(timer);
  }, [open, callState]);

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60).toString().padStart(2, '0');
    const secs = (seconds % 60).toString().padStart(2, '0');
    return `${mins}:${secs}`;
  };

  const handleEndCall = () => {
    endCall();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) { endCall(); } onOpenChange(v); }}>
      <DialogContent
        className={cn(
          "max-w-none w-screen h-screen p-0 border-0 bg-black flex flex-col items-center justify-center transition-all duration-500",
          isFullScreen ? "rounded-none" : "rounded-3xl max-w-[480px] h-[95vh] mx-auto"
        )}
        onInteractOutside={(e) => e.preventDefault()}
      >
        <DialogTitle className="sr-only">{t('call.video_title', { name: user?.name || '' })}</DialogTitle>
        <motion.div
          layout
          className="relative w-full h-full rounded-3xl overflow-hidden bg-gray-900 flex items-center justify-center"
        >
          <div className="absolute inset-0">
            {remoteStream ? (
              <video
                ref={remoteVideoRef}
                autoPlay
                playsInline
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center bg-gray-800">
                <div className="w-24 h-24 rounded-full bg-gray-700 flex items-center justify-center">
                  <span className="text-4xl text-white/50">{user?.name?.[0]}</span>
                </div>
              </div>
            )}
            {callState === 'calling' && (
              <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                <div className="text-white text-center">
                  <div className="w-16 h-16 mx-auto mb-4 rounded-full border-4 border-t-transparent border-white animate-spin" />
                  <p className="text-lg">{t('call.calling_name', { name: user?.name || '' })}</p>
                </div>
              </div>
            )}
            {callState === 'ringing' && (
              <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                <div className="text-white text-center">
                  <div className="w-16 h-16 mx-auto mb-4 rounded-full border-4 border-t-transparent border-white animate-spin" />
                  <p className="text-lg">{t('call.incoming_name', { name: user?.name || '' })}</p>
                </div>
              </div>
            )}
          </div>

          {callState === 'connected' && (
            <div className="relative z-10 flex flex-col items-center justify-center text-white pointer-events-none">
              <p className="text-lg font-mono tracking-widest mt-1">{formatDuration(callDuration)}</p>
            </div>
          )}

          <AnimatePresence>
            {!isVideoOff && localStream && (
              <motion.div
                initial={{ opacity: 0, scale: 0.8, y: 50 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.8, y: 50 }}
                drag
                dragConstraints={{ top: -250, left: -100, right: 100, bottom: 250 }}
                className="absolute bottom-28 sm:bottom-32 right-4 w-28 h-40 bg-gray-800 rounded-2xl overflow-hidden border-2 border-white/20 shadow-2xl cursor-grab active:cursor-grabbing"
              >
                <video
                  ref={localVideoRef}
                  autoPlay
                  muted
                  playsInline
                  className="w-full h-full object-cover scale-x-[-1]"
                />
                {isMuted && (
                  <div className="absolute bottom-1 right-1 p-1 bg-black/50 rounded-full">
                    <MicOff size={12} className="text-white" />
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>

          <div className="absolute bottom-8 left-1/2 -translate-x-1/2 flex items-center gap-4 bg-black/40 backdrop-blur-md p-3 rounded-full shadow-lg">
            <Button
              variant="ghost"
              size="icon"
              onClick={onToggleMute}
              aria-label={isMuted ? t('call.unmute') : t('call.mute')}
              className={cn(
                "w-14 h-14 rounded-full text-white hover:bg-white/20",
                isMuted && "bg-white/20"
              )}
            >
              {isMuted ? <MicOff size={24} /> : <Mic size={24} />}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={onToggleVideo}
              aria-label={isVideoOff ? t('call.video_on') : t('call.video_off')}
              className={cn(
                "w-14 h-14 rounded-full text-white hover:bg-white/20",
                isVideoOff && "bg-white/20"
              )}
            >
              {isVideoOff ? <VideoOff size={24} /> : <Video size={24} />}
            </Button>
            <Button
              size="icon"
              onClick={handleEndCall}
              aria-label={t('call.end')}
              className="w-16 h-14 rounded-full bg-red-500 hover:bg-red-600 text-white"
            >
              <PhoneOff size={28} />
            </Button>
          </div>

          <Button
            variant="ghost"
            size="icon"
            onClick={() => setIsFullScreen(!isFullScreen)}
            aria-label={isFullScreen ? t('call.exit_fullscreen') : t('call.fullscreen')}
            className="absolute top-4 right-4 w-10 h-10 rounded-full text-white bg-black/40 hover:bg-white/20"
          >
            {isFullScreen ? <Minimize size={20} /> : <Maximize size={20} />}
          </Button>
        </motion.div>
      </DialogContent>
    </Dialog>
  );
}
