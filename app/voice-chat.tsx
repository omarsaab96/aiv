import Entypo from '@expo/vector-icons/Entypo';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { Audio } from 'expo-av';
import * as FileSystem from 'expo-file-system';
import { LinearGradient } from 'expo-linear-gradient';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as Speech from 'expo-speech';
import React, { useEffect, useRef, useState } from 'react';
import {
    Animated,
    Dimensions,
    Easing,
    PanResponder,
    SafeAreaView,
    ScrollView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View
} from 'react-native';
import io from 'socket.io-client';

const screenWidth = Dimensions.get('window').width;
const screenHeight = Dimensions.get('window').height;


//working code//

const ELEVEN_API_KEY = 'sk_21d5a8b88e8f033bc02a25170a7dee126d00e4dd430af5e8';
const ELEVEN_BASE = 'https://api.elevenlabs.io/v1';

const recordingOptions = {
    android: {
        extension: '.m4a',
        outputFormat: 2, // MPEG_4
        audioEncoder: 3, // AAC
        sampleRate: 16000,
        numberOfChannels: 1,
        bitRate: 64000,
    },
    ios: {
        extension: '.caf',
        audioQuality: 96, // AUDIO_QUALITY_HIGH
        sampleRate: 16000,
        numberOfChannels: 1,
        bitRate: 64000,
        linearPCMBitDepth: 16,
        linearPCMIsBigEndian: false,
        linearPCMIsFloat: false,
    },
    isMeteringEnabled: true,
};

export default function VoiceChatScreen() {
    const router = useRouter();
    const { name = 'User', language = 'en' } = useLocalSearchParams();
    const recordingRef = useRef<Audio.Recording | null>(null);
    const [responseText, setResponseText] = useState('');
    const [voices, setVoices] = useState([]);
    const [formattedVoices, setFormattedVoices] = useState([]);
    const [selectedVoiceId, setSelectedVoiceId] = useState(null);
    const [isCancelled, setIsCancelled] = useState(false);
    const [showChangeVoiceModal, setShowChangeVoiceModal] = useState(false);
    const [recordingSeconds, setRecordingSeconds] = useState(0);
    const timerIntervalRef = useRef(null);
    const [messages, setMessages] = useState([]);
    const scrollRef = useRef(null);
    const popupOpacityAnim = useRef(new Animated.Value(0)).current;
    const popupTranslateYAnim = useRef(new Animated.Value(screenHeight)).current;
    const pressStartTimeRef = useRef<number | null>(null);
    const TAP_THRESHOLD_MS = 100;
    const selectedVoiceIdRef = useRef(selectedVoiceId);
    const [isSpeaking, setIsSpeaking] = useState(false);
    const [initialLoad, setInitialLoad] = useState(true);
    const [previewing, setPreviewing] = useState(null);
    const previewRef = useRef<Audio.Sound | null>(null);
    const [visibleVoicesCount, setVisibleVoicesCount] = useState(3);
    const [isRecording, setIsRecording] = useState(false);
    const [isPreparing, setIsPreparing] = useState(false);
    const isRecordingRef = useRef(false);
    const speechSoundRef = useRef<Audio.Sound | null>(null);
    const isSpeakingRef = useRef(false); // For Eco Mode

    const isCancelledRef = useRef(false);
    const dragX = useRef(new Animated.Value(0)).current;
    const socketRef = useRef(null);
    const ecoMode = false;

    const intervalRef = useRef(null);

    const bubbleColors = [
        'rgba(15, 248, 128, 1)',
        'rgba(47, 207, 243, 0.5)',
        'rgba(37, 182, 148, 0.8)',
    ];
    const bubbleShapes = [
        { borderTopLeftRadius: 250, borderTopRightRadius: 240, borderBottomLeftRadius: 240, borderBottomRightRadius: 250 },
        { borderTopLeftRadius: 140, borderTopRightRadius: 250, borderBottomLeftRadius: 250, borderBottomRightRadius: 140 },
        { borderTopLeftRadius: 245, borderTopRightRadius: 245, borderBottomLeftRadius: 235, borderBottomRightRadius: 235 },
    ];
    const moveAnims = [
        useRef(new Animated.ValueXY({ x: 0, y: 0 })).current,
        useRef(new Animated.ValueXY({ x: 0, y: 0 })).current,
        useRef(new Animated.ValueXY({ x: 0, y: 0 })).current,
    ];
    const opacityAnims = [
        useRef(new Animated.Value(1)).current,
        useRef(new Animated.Value(1)).current,
        useRef(new Animated.Value(1)).current,
    ];
    const scaleAnims = [
        useRef(new Animated.Value(1)).current,
        useRef(new Animated.Value(1)).current,
        useRef(new Animated.Value(1)).current,
    ];

    const startDrift = () => {
        moveAnims.forEach((anim, i) => {
            const scaleAnim = scaleAnims[i];

            const animate = () => {
                Animated.parallel([
                    // Position drifting
                    Animated.sequence([
                        Animated.timing(anim, {  // use the current moveAnim, not the array
                            toValue: {
                                x: (Math.random() - 0.5) * 10,
                                y: (Math.random() - 0.5) * 10,
                            },
                            duration: 3000 + Math.random() * 2000,
                            useNativeDriver: true,
                        }),
                        Animated.timing(anim, {
                            toValue: { x: 0, y: 0 },
                            duration: 3000 + Math.random() * 2000,
                            useNativeDriver: true,
                        }),
                    ]),

                    // Size shrinking & expanding
                    Animated.sequence([
                        Animated.timing(scaleAnim, {  // use individual scaleAnim, not the array
                            toValue: 0.8 + Math.random() * 0.4,
                            duration: 3000 + Math.random() * 2000,
                            useNativeDriver: true,
                        }),
                        Animated.timing(scaleAnim, {
                            toValue: 1,
                            duration: 3000 + Math.random() * 2000,
                            useNativeDriver: true,
                        }),
                    ]),
                ]).start(() => animate());
            };

            animate();
        });
    };

    // Slide to cancel recording animation
    const infoOpacity = dragX.interpolate({
        inputRange: [-300, 0],
        outputRange: [0, 1],
        extrapolate: 'clamp',
    });
    const panResponder = useRef(
        PanResponder.create({
            onStartShouldSetPanResponder: () => true,
            onPanResponderGrant: () => {
                isCancelledRef.current = false;
                setIsCancelled(false);
                pressStartTimeRef.current = Date.now();
                startRecording();

                console.log("PRESSED");
            },
            onPanResponderMove: (evt, gestureState) => {
                const newX = gestureState.dx < 0 ? Math.max(gestureState.dx, -300) : 0;
                dragX.setValue(newX);

                if (gestureState.dx < -50) {
                    isCancelledRef.current = true;
                    setIsCancelled(true);
                } else {
                    isCancelledRef.current = false;
                    setIsCancelled(false);
                }
            },
            onPanResponderRelease: async (evt, gestureState) => {
                console.log("RELEASED");

                const pressDuration = pressStartTimeRef.current ? (Date.now() - pressStartTimeRef.current) : 0;
                pressStartTimeRef.current = null;

                Animated.timing(dragX, {
                    toValue: 0,
                    duration: 200,
                    useNativeDriver: true,
                }).start();

                if (pressDuration < TAP_THRESHOLD_MS || isCancelledRef.current) {
                    console.log("WILLCANCEL")
                    await cancelRecording();
                } else {
                    console.log("WILLSTOP")
                    await stopRecording();
                }

                isCancelledRef.current = false;
                setIsCancelled(false);
            },
            onPanResponderTerminationRequest: () => false,
        })
    ).current;

    const formatTimer = (sec: number) => {
        const m = Math.floor(sec / 60).toString().padStart(2, '0');
        const s = (sec % 60).toString().padStart(2, '0');
        return `${m}:${s}`;
    };

    const fetchVoices = async () => {
        console.log("getting voices")

        const res = await fetch(`${ELEVEN_BASE}/voices`, {
            headers: { 'xi-api-key': ELEVEN_API_KEY }
        });
        const json = await res.json();
        setVoices(json.voices);

        console.log("Got " + json.voices.length + " voices")

        const formattedVoices = json.voices.map(v => ({
            voice_id: v.voice_id,
            name: v.name,
            accent: v.labels.accent || '',
            gender: v.labels.gender || '',
            description: v.description || '',
        }));

        setFormattedVoices(formattedVoices);


        // Only set default voice if nothing is already selected
        if (!selectedVoiceId && json.voices.length) {
            setSelectedVoiceId(json.voices[0].voice_id);
        }
    };

    const stopSpeech = async () => {
        // Stop Eco Mode speech
        if (isSpeakingRef.current) {
            Speech.stop();
            isSpeakingRef.current = false;
            setIsSpeaking(false);
        }

        // Stop Non-Eco Mode speech
        if (speechSoundRef.current) {
            speechSoundRef.current.stopAsync();
            speechSoundRef.current.unloadAsync();
            speechSoundRef.current = null;
            setIsSpeaking(false);
        }
    };

    const speakWithVoice = async (text: string) => {
        if (ecoMode) {
            isSpeakingRef.current = true;
            setInitialLoad(false)
            setIsSpeaking(true)
            setMessages(prev => prev.map((msg, idx) =>
                msg.status === 'pending' ? { ...msg, status: 'done' } : msg
            ));

            Speech.speak(text, {
                onDone: () => {
                    isSpeakingRef.current = false;
                    setIsSpeaking(false);
                },
                onStopped: () => {
                    isSpeakingRef.current = false;
                    setIsSpeaking(false);
                },
            });

            if (text.includes("Please choose a voice from the list.") || text.includes("Just say the name of the voice you want from the list below.") || text.includes("Here is a list of available voices.")) {
                setMessages((prev) => [...prev, { type: 'dialog', title: "Voice menu" }]);
            }
        } else {
            const voiceId = selectedVoiceIdRef.current;
            console.log('Speaking with ElevenLabs voice:', voiceId);

            try {
                const url = `${ELEVEN_BASE}/text-to-speech/${voiceId}`;
                const res = await fetch(url, {
                    method: 'POST',
                    headers: {
                        'xi-api-key': ELEVEN_API_KEY,
                        'Content-Type': 'application/json',
                        'Accept': 'audio/mpeg'
                    },
                    body: JSON.stringify({
                        text,
                        model_id: 'eleven_monolingual_v1',
                        voice_settings: {
                            stability: 0.5,
                            similarity_boost: 0.75,
                        },
                    }),
                });

                // console.log(res)

                const blob = await res.blob();

                // Save blob to file
                const reader = new FileReader();
                reader.onloadend = async () => {
                    const base64data = reader.result.split(',')[1]; // remove data:audio/mpeg;base64,
                    const path = FileSystem.documentDirectory + 'speech.mp3';
                    await FileSystem.writeAsStringAsync(path, base64data, {
                        encoding: FileSystem.EncodingType.Base64,
                    });

                    const { sound } = await Audio.Sound.createAsync({ uri: path }, { shouldPlay: true });
                    speechSoundRef.current = sound;

                    sound.setOnPlaybackStatusUpdate((status) => {
                        if (status.didJustFinish || status.isBuffering === false && !status.isPlaying) {
                            setIsSpeaking(false); // Stop animations
                            speechSoundRef.current = null;
                        }
                    });

                    setIsSpeaking(true)
                    setInitialLoad(false)
                    setMessages(prev => prev.map((msg, idx) =>
                        msg.status === 'pending' ? { ...msg, status: 'done' } : msg
                    ));
                    await sound.playAsync();

                    if (text.includes("Please choose a voice from the list.") || text.includes("Just say the name of the voice you want from the list below.") || text.includes("Here is a list of available voices.")) {
                        setVisibleVoicesCount(3)
                        setMessages((prev) => [...prev, { type: 'dialog', title: "Voice menu" }]);
                    }
                };
                reader.readAsDataURL(blob);
            } catch (error) {
                console.error('Error during ElevenLabs playback:', error);
            }
        }
    };

    useEffect(() => {
        if (isSpeaking) {
            intervalRef.current = setInterval(() => {
                pulse(0.2 + Math.random() * 0.3);
            }, 100);
        } else {
            clearInterval(intervalRef.current);
            intervalRef.current = null;
        }
    }, [isSpeaking]);

    useEffect(() => {
        prepareRecorder();
        fetchVoices();
        startDrift();

        return () => {
            stopSpeech();
            // Cleanup on unmount
            if (recordingRef.current) {
                recordingRef.current.stopAndUnloadAsync().catch(console.warn);
                recordingRef.current = null;
            }
            if (previewRef.current) {
                previewRef.current.unloadAsync().catch(console.warn);
                previewRef.current = null;
            }
            clearAllIntervals();
        };
    }, []);

    const clearAllIntervals = () => {
        if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
        if (intervalRef.current) clearInterval(intervalRef.current);
        timerIntervalRef.current = null;
        intervalRef.current = null;
    };

    useEffect(() => {
        selectedVoiceIdRef.current = selectedVoiceId;
    }, [selectedVoiceId]);

    useEffect(() => {
        Audio.setAudioModeAsync({
            allowsRecordingIOS: false,
            playsInSilentModeIOS: true,
        });

        const newSocket = io('https://voiceai-ofav.onrender.com');

        newSocket.on('connect', () => {
            newSocket.emit('setup', { language, name, voices: formattedVoices, })

            setTimeout(() => {
                newSocket.emit('greet_user');
            }, 500);
        });

        newSocket.on('ai_response', async ({ text }) => {
            setMessages((prev) => [...prev, { type: 'ai', text, status: 'pending' }]);
            console.info('AI response:', text);
            await speakWithVoice(text);
        });

        newSocket.on('voice_suggestion', ({ voiceName, voiceId }) => {
            console.log(`Server suggested new voice: ${voiceName} (${voiceId})`);
            setSelectedVoiceId(voiceId);
            selectedVoiceIdRef.current = voiceId;
        });

        newSocket.on('user_transcription', ({ text }) => {
            setMessages(prev => [...prev, { type: 'user', text }]);
        });

        socketRef.current = newSocket;
        return () => newSocket.disconnect();
    }, [language, name, formattedVoices]);

    const pulse = (volume: number) => {
        scaleAnims.forEach((anim, i) => {
            Animated.timing(anim, {
                toValue: 1 + volume * (0.5 - i * 0.1), // dampened by index
                duration: 150,                        // smooth pulse duration
                easing: Easing.out(Easing.ease),     // soft easing
                useNativeDriver: true,
            }).start();
        });
    };

    const prepareRecorder = async () => {
        if (recordingRef.current || isPreparing) return;

        setIsPreparing(true);
        try {
            const { granted } = await Audio.requestPermissionsAsync();
            if (!granted) {
                console.warn('Microphone permission not granted');
                return;
            }

            await Audio.setAudioModeAsync({
                allowsRecordingIOS: true,
                playsInSilentModeIOS: true,
            });

            const rec = new Audio.Recording();
            await rec.prepareToRecordAsync(recordingOptions);
            recordingRef.current = rec;
        } catch (err) {
            console.error("Failed to prepare recorder:", err);
        }
    };

    const startRecording = async () => {
        await stopSpeech();
        if (isRecording || isPreparing) {
            console.log("isRecording is false");
            return;
        };

        try {
            if (!recordingRef.current) {
                await prepareRecorder();
            }

            if (recordingRef.current) {
                console.log('Starting recording...');
                await recordingRef.current.startAsync();
                isRecordingRef.current = true;
                setIsRecording(true);

                setRecordingSeconds(0);
                timerIntervalRef.current = setInterval(() => {
                    setRecordingSeconds(sec => sec + 1);
                }, 1000);

                intervalRef.current = setInterval(() => {
                    pulse(0.2 + Math.random() * 0.3);
                }, 100);
            }
        } catch (err) {
            console.error('Failed to start recording:', err);
            isRecordingRef.current = false;
            setIsRecording(false);
        }
    };

    const stopRecording = async () => {
        if (!isRecordingRef.current) {
            console.log("isRecording is false");
            return;
        }

        console.log('Stopping recording...');
        isRecordingRef.current = false;
        setIsRecording(false);

        // Clear intervals immediately
        if (intervalRef.current) {
            clearInterval(intervalRef.current);
            intervalRef.current = null;
        }
        if (timerIntervalRef.current) {
            clearInterval(timerIntervalRef.current);
            timerIntervalRef.current = null;
        }

        const recording = recordingRef.current;
        if (!recording) {
            console.log('No active recording');
            return;
        }

        try {
            await recording.stopAndUnloadAsync();
            const uri = recording.getURI();
            console.log('Recording URI:', uri);

            if (uri && socketRef.current?.connected) {
                const base64 = await FileSystem.readAsStringAsync(uri, {
                    encoding: FileSystem.EncodingType.Base64,
                });
                socketRef.current.emit('audio_chunk', base64);
                socketRef.current.emit('audio_end');
            }
        } catch (err) {
            console.error('Failed to stop recording:', err);
        } finally {
            recordingRef.current = null;
            setRecordingSeconds(0);
            prepareRecorder();
        }

        // if (ecoMode) {
        //     const text = "Hey, it's so good to meet you! I'm Froogle, your grocery shopping assistant. Let's talk about your grocery shopping routine! When do you usually go shopping? Is there a specific day that works best for you?";
        //     setMessages((prev) => [...prev, { type: 'ai', text }]);
        //     await speakWithVoice(text);
        //     return;
        // }

    };

    const cancelRecording = async () => {
        if (!isRecordingRef.current) return;
        isRecordingRef.current = false;
        setIsRecording(false);


        // Clear intervals immediately
        if (intervalRef.current) {
            clearInterval(intervalRef.current);
            intervalRef.current = null;
        }
        if (timerIntervalRef.current) {
            clearInterval(timerIntervalRef.current);
            timerIntervalRef.current = null;
        }

        try {
            const recording = recordingRef.current;
            if (recording) {
                await recording.stopAndUnloadAsync();
            }
        } catch (error) {
            console.warn('Error canceling recording:', error);
        } finally {
            recordingRef.current = null;
            setRecordingSeconds(0);
            prepareRecorder();
            console.log('Recording cancelled');
        }
    };

    const handlePreview = async (id: string, url: string) => {
        setPreviewing(id)
        try {
            if (previewRef.current) {
                await previewRef.current.stopAsync();
                await previewRef.current.unloadAsync();
                previewRef.current = null;
            }

            const { sound } = await Audio.Sound.createAsync(
                { uri: url },
                { shouldPlay: true }
            );

            previewRef.current = sound;

            // Optional: Stop and unload after playing
            sound.setOnPlaybackStatusUpdate((status) => {
                if (status.isLoaded && status.didJustFinish) {
                    sound.unloadAsync();
                    previewRef.current = null;
                    setPreviewing(null)
                }
            });

        } catch (error) {
            console.error('Error playing preview:', error);
            setPreviewing(null)
        }

    }

    const handleStop = async () => {
        if (previewRef.current) {
            await previewRef.current.stopAsync();
            await previewRef.current.unloadAsync();
            previewRef.current = null;
            setPreviewing(null);
        }
    };

    const capitalize = (str: string) => str.charAt(0).toUpperCase() + str.slice(1);

    return (
        <SafeAreaView style={styles.containerSafeArea}>
            <View style={styles.container}>
                <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
                    <Text style={styles.backText}>&lt; Back</Text>
                </TouchableOpacity>

                <View style={styles.chatWrapper}>
                    <LinearGradient
                        colors={['#f4f4f4', 'rgba(255,255,255,0)']}
                        style={styles.topGradient}
                        pointerEvents="none"
                    />
                    <ScrollView style={styles.chatScroller}
                        ref={scrollRef}
                        onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: true })}
                    >
                        {initialLoad ?
                            (
                                <Text>Loading</Text>
                            ) : (

                                messages.map((msg, idx) => (
                                    <View
                                        key={idx}
                                        style={[
                                            styles.chatBubble,
                                            msg.type === 'user' ? styles.userBubble : null
                                        ]}
                                    >
                                        {msg.type === 'dialog' ? (
                                            <View style={[
                                                styles.chatText,
                                                msg.type === 'user' ? styles.userText : null,
                                                { width: '100%' }
                                            ]}>
                                                {!voices && <Text>Loading voices...</Text>}
                                                {voices && (
                                                    <>
                                                        {voices.slice(0, visibleVoicesCount).map((v) => (
                                                            <View
                                                                key={v.voice_id}
                                                                style={[styles.voice, {
                                                                    // backgroundColor: selectedVoiceId === v.voice_id ? 'rgb(34, 169, 137)' : '#ddd'
                                                                    backgroundColor: '#ddd'
                                                                }]}>

                                                                <View style={styles.voiceHead}>
                                                                    <View style={[styles.voiceHead, { flex: 1, justifyContent: 'flex-start' }]}>
                                                                        {/* <TouchableOpacity onPress={() => setSelectedVoiceId(v.voice_id)}  style={[styles.voiceHead, { flex: 1, justifyContent: 'flex-start' }]}> */}
                                                                        <Text style={[
                                                                            styles.voiceTitle,
                                                                            // { color: selectedVoiceId === v.voice_id ? '#fff' : '#000' }
                                                                        ]
                                                                        }>{v.name}</Text>
                                                                        {v.labels?.accent && <Text style={
                                                                            [styles.voiceAccent,
                                                                                // { color: selectedVoiceId === v.voice_id ? '#fff' : '#000' }

                                                                            ]}>{capitalize(v.labels.accent)}</Text>}
                                                                        {v.labels?.language && <Text style={
                                                                            [styles.voiceLanguage,
                                                                                // { color: selectedVoiceId === v.voice_id ? '#fff' : '#000' }

                                                                            ]}>{capitalize(v.labels.language)}</Text>}
                                                                        {/* </TouchableOpacity> */}
                                                                    </View>
                                                                    <View>
                                                                        {previewing == v.voice_id ? (
                                                                            <TouchableOpacity style={{ flexDirection: 'row', alignItems: 'center', columnGap: 5 }} onPress={handleStop}>
                                                                                <FontAwesome name="stop" size={12} color="black" />
                                                                                <Text>Stop</Text>
                                                                            </TouchableOpacity>
                                                                        ) : (
                                                                            <TouchableOpacity style={{ flexDirection: 'row', alignItems: 'center', columnGap: 5 }} onPress={() => handlePreview(v.voice_id, v.preview_url)}>
                                                                                <FontAwesome name="play" size={12} color="black" />
                                                                                <Text>Preview</Text>
                                                                            </TouchableOpacity>
                                                                        )}
                                                                    </View>
                                                                </View>

                                                            </View>
                                                        ))}

                                                        {visibleVoicesCount < voices.length && (
                                                            <TouchableOpacity onPress={() => setVisibleVoicesCount(prev => prev + 5)}>
                                                                <Text style={{ alignSelf: 'center', color: '#007AFF', marginTop: 8 }}>Show more voices</Text>
                                                            </TouchableOpacity>
                                                        )}
                                                    </>
                                                )}
                                            </View>
                                        ) : (
                                            <Text
                                                style={[
                                                    styles.chatText,
                                                    msg.type === 'user' ? styles.userText : null
                                                ]}
                                            >
                                                {msg.type == 'ai' && msg.status == 'pending' && 'Thinking'}
                                                {msg.type == 'ai' && msg.status == 'done' && msg.text}
                                                {msg.type == 'user' && msg.text}
                                            </Text>
                                        )}
                                    </View>
                                ))

                            )
                        }

                    </ScrollView>
                </View >

                <View style={styles.bubbleContainer}>
                    {scaleAnims.map((scale, i) => (
                        <Animated.View
                            key={i}
                            style={[
                                styles.bubble,
                                bubbleShapes[i],
                                {
                                    backgroundColor: bubbleColors[i],
                                    opacity: opacityAnims[i],
                                    shadowColor: bubbleColors[i].replace(/rgba\((.+),\s*[\d\.]+\)/, 'rgba($1, 0.6)'),
                                    transform: [
                                        { scale },
                                        { translateX: moveAnims[i].x },
                                        { translateY: moveAnims[i].y },
                                    ],
                                },
                            ]}
                        />
                    ))}
                </View>

                {/* <TouchableOpacity onPress={openVoicePopup} style={styles.changeVoiceButtonContainer}>
                    <Text style={styles.changeVoiceButton}>Change voice</Text>
                </TouchableOpacity> */}

                <View style={styles.micContainer}>
                    <Animated.Text style={[styles.micContainerTimer, { opacity: infoOpacity }]}>
                        {isRecording && <Text>{formatTimer(recordingSeconds)}</Text>}
                    </Animated.Text>

                    {isRecording &&
                        <Animated.View style={[styles.micContainerHint, { opacity: infoOpacity }]}>
                            <View style={styles.micContainerHintWrapper}>
                                <Entypo name="chevron-left" size={24} color="black" />
                                <Text style={styles.micContainerHintText}>Slide to cancel</Text>
                            </View>
                        </Animated.View>
                    }
                    {!isRecording &&
                        <View style={styles.micContainerHint}>
                            <Text style={styles.micContainerHintText}>Hold to record</Text>
                        </View>
                    }
                    <Animated.View
                        {...panResponder.panHandlers}
                        style={[
                            styles.micButton,
                            {
                                transform: [{ translateX: dragX }],
                                backgroundColor: isCancelled ? '#ff3b30' : '#25b694',

                            },
                        ]}
                    >
                        <Text style={styles.buttonText}>
                            <FontAwesome name="microphone" size={30} color="white" />
                        </Text>
                    </Animated.View>
                </View>
            </View>
        </SafeAreaView >
    );
}

const styles = StyleSheet.create({
    containerSafeArea: { flex: 1, backgroundColor: '#f4f4f4' },
    container: { flex: 1, alignItems: 'center', justifyContent: 'flex-start', padding: 20 },
    button: { backgroundColor: '#3F7EFC', padding: 15, borderRadius: 10 },
    buttonText: { color: '#fff', fontWeight: 'bold' },
    response: { fontSize: 18, textAlign: 'center' },
    backButton: { flexDirection: 'row', width: '100%', marginBottom: 10, marginTop: 20 },
    backText: { fontSize: 18, color: '#25b694' },
    micContainer: {
        position: 'absolute',
        bottom: 70,
        // borderWidth: 1,
        flexDirection: 'row',
        width: '100%',
        alignItems: 'center',
        justifyContent: 'space-between',
        height: 60,
        paddingRight: 80,
    },
    micContainerHint: {
        fontSize: 18,
        flexDirection: 'row',
        alignItems: 'baseline',
    },
    micContainerHintWrapper: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    micContainerHintText: {
        fontSize: 14,
    },
    micContainerTimer: {
        fontSize: 14,
        marginRight: 20
    },
    micButton: {
        position: 'absolute',
        right: 0,
        backgroundColor: '#25b694',
        padding: 10,
        height: 60,
        width: 60,
        borderRadius: 60,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center'
    },
    bubbleContainer: {
        justifyContent: 'center',
        alignItems: 'center',
        width: '100%',
        height: '10%',
    },
    bubble: {
        position: 'absolute',
        width: 50,
        height: 50,
        left: 0,
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: 0.6,
        shadowRadius: 15,
        elevation: 20,
    },
    chatWrapper: {
        width: '100%',
        height: '70%',
        justifyContent: 'flex-end',
        position: 'relative',
    },
    topGradient: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        height: 100,
        zIndex: 10,
        // borderWidth:1
    },
    chatScroller: {
        // borderWidth: 1,
        flexGrow: 0,
        maxHeight: '100%',
    },
    chatBubble: {
        marginBottom: 10,
        flexDirection: 'row',
    },
    userBubble: {
        flexDirection: 'row-reverse',
    },
    chatText: {
        backgroundColor: 'rgba(163, 169, 168, 0.2)',
        fontSize: 16,
        padding: 10,
        borderRadius: 20,
        borderTopLeftRadius: 0,
        maxWidth: '80%',
    },
    userText: {
        backgroundColor: 'rgba(37, 182, 148, 0.2)',
        borderTopLeftRadius: 20,
        borderTopRightRadius: 0,
    },
    popupContainer: {
        position: 'absolute',
        width: screenWidth,
        height: '100%',
        bottom: 0,
        left: 0,
        top: 0,
        backgroundColor: 'rgba(0,0,0,0.5)',
        zIndex: 1000,
        justifyContent: 'flex-end',
    },
    popupContent: {
        width: '100%',
        height: '100%',
        maxHeight: screenHeight * 0.75,
        padding: 15,
        borderTopLeftRadius: 30,
        borderTopRightRadius: 30,
        backgroundColor: '#ffffff',
        paddingBottom: 20,
    },
    draggerContainer: {
    },
    dragger: {
        borderRadius: 30,
        backgroundColor: '#aaa',
        width: 100,
        height: 7,
        alignSelf: 'center',
        marginBottom: 20,
    },
    popupTitleContainer: {
        marginBottom: 10
    },
    popupTitle: {
        fontSize: 24,
        fontWeight: 'bold',
    },
    voice: {
        padding: 5,
        marginBottom: 5,
        borderRadius: 10,
    },
    voiceHead: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between'
    },
    voiceTitle: {
        flexDirection: 'row',
        fontWeight: 'bold',
        fontSize: 14
    },
    voiceAccent: {
        marginLeft: 10,
        fontSize: 14,
        opacity: 0.6,
    },
    voiceLanguage: {
        marginLeft: 10,
        fontSize: 14,
        opacity: 0.6,
    },
    voiceDescription: {
        fontSize: 14
    },
    changeVoiceButtonContainer: {
        // borderWidth: 1,
        flexDirection: 'row',
        width: '100%',
    },
    changeVoiceButton: {
        color: '#25b694',
    },
    overlayTouchable: {
        flex: 1,
        justifyContent: 'flex-end',
    }
});
