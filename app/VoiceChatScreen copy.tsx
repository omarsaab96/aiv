import Entypo from '@expo/vector-icons/Entypo';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import * as FileSystem from 'expo-file-system';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as Speech from 'expo-speech';
import React, { useEffect, useRef, useState } from 'react';
import {
    Animated,
    Dimensions,
    Easing,
    PanResponder,
    ScrollView,
    StyleSheet,
    Text,
    TouchableOpacity,
    TouchableWithoutFeedback,
    View
} from 'react-native';
import io from 'socket.io-client';

const screenWidth = Dimensions.get('window').width;
const screenHeight = Dimensions.get('window').height;


//working code 

const ELEVEN_API_KEY = 'sk_21d5a8b88e8f033bc02a25170a7dee126d00e4dd430af5e8';
const ELEVEN_BASE = 'https://api.elevenlabs.io/v1';

export default function VoiceChatScreen() {
    const router = useRouter();
    const { name = 'User', language = 'en' } = useLocalSearchParams();
    const recordingRef = useRef<Audio.Recording | null>(null);
    const [responseText, setResponseText] = useState('');
    const [voices, setVoices] = useState([]);
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
    const TAP_THRESHOLD_MS = 500;
    const selectedVoiceIdRef = useRef(selectedVoiceId);
    const [isSpeaking, setIsSpeaking] = useState(false);


    const isCancelledRef = useRef(false);
    const dragX = useRef(new Animated.Value(0)).current;
    const dragY = useRef(new Animated.Value(0)).current;
    const socketRef = useRef(null);
    const ecoMode = true;

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
            onPanResponderRelease: () => {
                const pressDuration = pressStartTimeRef.current ? (Date.now() - pressStartTimeRef.current) : 0;
                pressStartTimeRef.current = null;

                if (pressDuration < TAP_THRESHOLD_MS) {
                    cancelRecording();
                } else {

                    if (isCancelledRef.current) {
                        cancelRecording();
                    } else {
                        if (!recordingRef.current) {
                            console.warn('RELEASE: recording is still null!');
                        }
                        stopRecording();
                    }
                }
                Animated.timing(dragX, {
                    toValue: 0,
                    duration: 200,
                    useNativeDriver: true,
                }).start();

                isCancelledRef.current = false;
                setIsCancelled(false);
            },
            onPanResponderTerminationRequest: () => false,
        })
    ).current;

    const popupOpacity = dragY.interpolate({
        inputRange: [0, 200],
        outputRange: [1, 0],
        extrapolate: 'clamp',
    });
    const panResponderPopup = useRef(
        PanResponder.create({
            onMoveShouldSetPanResponder: (_, gestureState) => {
                return gestureState.dy > 5; // only respond to downward drags
            },
            onPanResponderMove: (_, gestureState) => {
                if (gestureState.dy > 0) {
                    popupTranslateYAnim.setValue(gestureState.dy);
                }
            },
            onPanResponderRelease: (_, gestureState) => {
                if (gestureState.dy > 100) {
                    closeVoicePopup();
                } else {
                    Animated.spring(popupTranslateYAnim, {
                        toValue: 0,
                        useNativeDriver: true,
                    }).start();
                }
            },
        })
    ).current;

    const formatTimer = (sec: number) => {
        const m = Math.floor(sec / 60).toString().padStart(2, '0');
        const s = (sec % 60).toString().padStart(2, '0');
        return `${m}:${s}`;
    };

    const fetchVoices = async () => {
        const res = await fetch(`${ELEVEN_BASE}/voices`, {
            headers: { 'xi-api-key': ELEVEN_API_KEY }
        });
        const json = await res.json();
        setVoices(json.voices);

        // Only set default voice if nothing is already selected
        if (!selectedVoiceId && json.voices.length) {
            setSelectedVoiceId(json.voices[0].voice_id);
        }
    };

    const speakWithVoice = async (text: string) => {
        if (ecoMode) {
            setIsSpeaking(true)
            Speech.speak(text);
            setIsSpeaking(false)
            return;
        }

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

                setIsSpeaking(true); // Start animations

                const { sound } = await Audio.Sound.createAsync({ uri: path }, { shouldPlay: true });

                sound.setOnPlaybackStatusUpdate((status) => {
                    if (status.didJustFinish || status.isBuffering === false && !status.isPlaying) {
                        setIsSpeaking(false); // Stop animations
                    }
                });

                await sound.playAsync();
            };
            reader.readAsDataURL(blob);
        } catch (error) {
            console.error('Error during ElevenLabs playback:', error);
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
        fetchVoices();
        startDrift();
    }, []);

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
            newSocket.emit('setup', { language, name })

            setTimeout(() => {
                newSocket.emit('greet_user');
            }, 500);
        });

        newSocket.on('ai_response', async ({ text }) => {
            setMessages((prev) => [...prev, { type: 'ai', text }]);
            console.info('AI response:', text);
            await speakWithVoice(text);
        });

        newSocket.on('user_transcription', ({ text }) => {
            setMessages(prev => [...prev, { type: 'user', text }]);
        });

        socketRef.current = newSocket;
        return () => newSocket.disconnect();
    }, [language, name]);

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

    const startRecording = async () => {
        console.log('Recording started');
        const { granted } = await Audio.requestPermissionsAsync();
        if (!granted) {
            console.warn('Microphone permission not granted');
            return;
        }

        const recordingOptions = {
            android: {
                extension: '.m4a',
                outputFormat: 2, // MPEG_4
                audioEncoder: 3, // AAC
                sampleRate: 44100,
                numberOfChannels: 2,
                bitRate: 128000,
            },
            ios: {
                extension: '.caf',
                audioQuality: 96, // AUDIO_QUALITY_HIGH
                sampleRate: 44100,
                numberOfChannels: 2,
                bitRate: 128000,
                linearPCMBitDepth: 16,
                linearPCMIsBigEndian: false,
                linearPCMIsFloat: false,
            },
            web: {},
            isMeteringEnabled: true,
        };

        try {
            await Audio.requestPermissionsAsync();
            await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });

            const rec = new Audio.Recording();
            await rec.prepareToRecordAsync(recordingOptions);
            await rec.startAsync();
            recordingRef.current = rec;
            intervalRef.current = setInterval(() => {
                pulse(0.2 + Math.random() * 0.3);
            }, 100);

            setRecordingSeconds(0);
            timerIntervalRef.current = setInterval(() => {
                setRecordingSeconds(sec => sec + 1);
            }, 1000);
        } catch (err) {
            console.error('Failed to start recording:', err);
        }
    };

    const stopRecording = async () => {
        console.log('Recording stopped');

        if (ecoMode) {
            const text = "Hey, it's so good to meet you! I'm Froogle, your grocery shopping assistant. Let's talk about your grocery shopping routine! When do you usually go shopping? Is there a specific day that works best for you?";
            setMessages((prev) => [...prev, { type: 'ai', text }]);
            await speakWithVoice(text);
            return;
        }

        const recording = recordingRef.current;
        if (!recording) {
            console.log('No recording to stop (ref is null)');
            return;
        }

        clearInterval(intervalRef.current);
        intervalRef.current = null;
        clearInterval(timerIntervalRef.current);
        timerIntervalRef.current = null;

        try {
            await recording.stopAndUnloadAsync();
            const uri = recording.getURI();
            recordingRef.current = null;

            if (uri && socketRef.current) {
                const base64 = await FileSystem.readAsStringAsync(uri, {
                    encoding: FileSystem.EncodingType.Base64,
                });

                socketRef.current.emit('audio_chunk', base64);
                socketRef.current.emit('audio_end');
            }
        } catch (err) {
            console.error('Failed to stop and unload recording:', err);
        }


    };

    const cancelRecording = async () => {
        try {
            const recording = recordingRef.current;
            if (recording) {
                await recording.stopAndUnloadAsync();
                recordingRef.current = null;
            }
        } catch (error) {
            console.warn('Error canceling recording:', error);
            recordingRef.current = null;
        }

        clearInterval(intervalRef.current);
        intervalRef.current = null;
        clearInterval(timerIntervalRef.current);
        timerIntervalRef.current = null;
        setRecordingSeconds(0);
        console.log('Recording cancelled')
    };

    const openVoicePopup = () => {
        setShowChangeVoiceModal(true);

        // Animate in
        Animated.parallel([
            Animated.timing(popupOpacityAnim, {
                toValue: 1,
                duration: 250,
                useNativeDriver: true,
            }),
            Animated.timing(popupTranslateYAnim, {
                toValue: 0,
                duration: 300,
                useNativeDriver: true,
            }),
        ]).start();
    };

    const closeVoicePopup = () => {
        Animated.parallel([
            Animated.timing(popupOpacityAnim, {
                toValue: 0,
                duration: 200,
                useNativeDriver: true,
            }),
            Animated.timing(popupTranslateYAnim, {
                toValue: screenHeight,
                duration: 250,
                useNativeDriver: true,
            }),
        ]).start(() => {
            setShowChangeVoiceModal(false);
        });
    };

    return (
        <View style={styles.container}>
            {/* <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
                <Text style={styles.backText}>← Back</Text>
            </TouchableOpacity> */}

            <View style={styles.chatWrapper}>
                <ScrollView style={styles.chatScroller}
                    ref={scrollRef}
                    onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: true })}
                >
                    {messages.map((msg, idx) => (
                        <View
                            key={idx}
                            style={[
                                styles.chatBubble,
                                msg.type === 'user' ? styles.userBubble : null
                            ]}
                        >
                            <Text
                                style={[
                                    styles.chatText,
                                    msg.type === 'user' ? styles.userText : null
                                ]}
                            >
                                {msg.text}
                            </Text>
                        </View>
                    ))}
                </ScrollView>
            </View>

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

            <TouchableOpacity onPress={openVoicePopup} style={styles.changeVoiceButtonContainer}>
                <Text style={styles.changeVoiceButton}>Change voice</Text>
            </TouchableOpacity>

            <View style={styles.micContainer}>

                <Animated.Text style={[styles.micContainerTimer, { opacity: infoOpacity }]}>
                    {recordingRef.current && <Text>{formatTimer(recordingSeconds)}</Text>}
                </Animated.Text>

                {recordingRef.current &&
                    <Animated.View style={[styles.micContainerHint, { opacity: infoOpacity }]}>
                        <View style={styles.micContainerHintWrapper}>
                            <Entypo name="chevron-left" size={24} color="black" />
                            <Text style={styles.micContainerHintText}>Slide to cancel</Text>
                        </View>
                    </Animated.View>
                }
                {!recordingRef.current &&
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
                        },
                    ]}
                >
                    <Text style={styles.buttonText}>
                        <FontAwesome name="microphone" size={30} color="white" />
                    </Text>
                </Animated.View>
            </View>

            {showChangeVoiceModal &&
                <Animated.View style={[
                    styles.popupContainer,
                    {
                        opacity: popupOpacityAnim,
                    },
                ]}>
                    <View style={styles.overlayTouchable}>
                        <TouchableWithoutFeedback onPress={closeVoicePopup}>
                            <View style={{ flex: 1 }} />
                        </TouchableWithoutFeedback>
                        <Animated.View style={[styles.popupContent, {
                            transform: [{ translateY: popupTranslateYAnim }],
                        },]}>
                            <View
                                style={styles.draggerContainer}
                                {...panResponderPopup.panHandlers}
                            >
                                <View style={styles.dragger} />

                                <View style={styles.popupTitleContainer}>
                                    <Text style={styles.popupTitle}>Change assistant voice</Text>
                                </View>
                            </View>

                            <ScrollView>
                                {!voices && <Text>Loading voices...</Text>}
                                {voices && voices.map((v) => (
                                    <TouchableOpacity
                                        key={v.voice_id}
                                        onPress={() => setSelectedVoiceId(v.voice_id)}
                                        style={[styles.voice, {
                                            backgroundColor: selectedVoiceId === v.voice_id ? 'rgb(34, 169, 137)' : '#ddd'
                                        }]}>

                                        <View style={styles.voiceHead}>
                                            <Text style={[styles.voiceTitle, { color: selectedVoiceId === v.voice_id ? '#fff' : '#000' }]}>{v.name}</Text>
                                            {v.labels.accent && <Text style={[styles.voiceAccent, { color: selectedVoiceId === v.voice_id ? '#fff' : '#000' }]}>{v.labels.accent}</Text>}
                                            {v.labels.language && <Text style={[styles.voiceLanguage, { color: selectedVoiceId === v.voice_id ? '#fff' : '#000' }]}>{v.labels.language}</Text>}
                                        </View>
                                        <Text style={[styles.voiceDescription, { color: selectedVoiceId === v.voice_id ? '#fff' : '#666' }]}>{v.description}</Text>
                                    </TouchableOpacity>
                                ))}
                            </ScrollView>
                        </Animated.View>
                    </View>
                </Animated.View>
            }
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, alignItems: 'center', justifyContent: 'flex-start', padding: 20, backgroundColor: '#f4f4f4' },
    button: { backgroundColor: '#3F7EFC', padding: 15, borderRadius: 10 },
    buttonText: { color: '#fff', fontWeight: 'bold' },
    response: { fontSize: 18, textAlign: 'center' },
    backButton: { position: 'absolute', top: 40, left: 20 },
    backText: { fontSize: 18, color: '#3F7EFC' },
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
        height: '40%',
        // borderWidth: 1,
    },
    bubble: {
        position: 'absolute',
        width: 100,
        height: 100,
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: 0.6,
        shadowRadius: 15,
        elevation: 20,
    },
    chatWrapper: {
        width: '100%',
        height: '40%',
        justifyContent: 'flex-end',
        // borderWidth: 1
    },
    chatScroller: {
        // borderWidth: 1,
        flexGrow: 0,
        maxHeight: '100%',
    },
    chatBubble: {
        marginBottom: 10,
        flexDirection: 'row'
    },
    userBubble: {
        flexDirection: 'row-reverse'
    },
    chatText: {
        backgroundColor: 'rgba(163, 169, 168, 0.2)',
        fontSize: 16,
        padding: 10,
        borderRadius: 20,
        borderBottomLeftRadius: 0,
        maxWidth: '80%',
    },
    userText: {
        backgroundColor: 'rgba(37, 182, 148, 0.2)',
        borderBottomLeftRadius: 20,
        borderBottomRightRadius: 0
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
        padding: 10,
        marginBottom: 8,
        borderRadius: 20
    },
    voiceHead: {
        flexDirection: 'row',
        marginBottom: 5,
        alignItems: 'center',
    },
    voiceTitle: {
        flexDirection: 'row',
        fontWeight: 'bold',
        fontSize: 16
    },
    voiceAccent: {
        marginLeft: 10,
        fontSize: 14
    },
    voiceLanguage: {
        marginLeft: 10,
        fontSize: 14
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
