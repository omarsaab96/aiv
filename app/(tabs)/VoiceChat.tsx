import { Picker } from '@react-native-picker/picker';
import * as FileSystem from 'expo-file-system';
import * as Speech from 'expo-speech';
import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import io from 'socket.io-client';

const socket = io('https://voiceai-ofav.onrender.com');

export default function VoiceChat() {
    const [recording, setRecording] = useState<Audio.Recording | null>(null);
    const [responseText, setResponseText] = useState('');
    const [language, setLanguage] = useState('en');
    const [name, setName] = useState('Omar');

    const socketRef = useRef(null);

    useEffect(() => {
        const newSocket = io('https://voiceai-ofav.onrender.com');

        newSocket.on('connect', () => {
            console.log('Socket connected:', newSocket.id);

            // Send setup only once socket is definitely connected
            newSocket.emit('setup', { language, name });
        });

        newSocket.on('disconnect', () => {
            console.log('Socket disconnected');
        });

        newSocket.on('ai_response', ({ text }) => {
            console.log('AI Response:', text);
            setResponseText(text);
            Speech.speak(text);
        });

        socketRef.current = newSocket;

        return () => {
            newSocket.disconnect();
        };
    }, [language, name]);

    const startRecording = async () => {
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
            setRecording(rec);
        } catch (err) {
            console.error('Failed to start recording:', err);
        }
    };

    const stopRecording = async () => {
        if (!recording) return;

        await recording.stopAndUnloadAsync();
        const uri = recording.getURI();
        setRecording(null);

        if (uri && socketRef.current) {
            const base64 = await FileSystem.readAsStringAsync(uri, {
                encoding: FileSystem.EncodingType.Base64,
            });

            socketRef.current.emit('audio_chunk', base64);
            socketRef.current.emit('audio_end');
        }
    };

    return (
        <View style={styles.container}>
            <Text style={{ marginBottom: 10, fontSize: 18 }}>select language</Text>
            <View style={{ width: 250, height: 100, borderWidth: 1, borderColor: '#ccc', marginBottom: 20 }}>
                <Picker
                    selectedValue={language}
                    onValueChange={(lang) => setLanguage(lang)}
                    style={{ flex: 1 }}
                    itemStyle={{ fontSize: 18 }} // iOS only, adjusts font size in picker
                >
                    <Picker.Item label="English" value="en" />
                    <Picker.Item label="Arabic" value="ar" />
                    <Picker.Item label="French" value="fr" />
                </Picker>
            </View>

            <TouchableOpacity style={styles.button} onPress={recording ? stopRecording : startRecording}>
                <Text style={styles.buttonText}>{recording ? 'Stop' : 'Start Talking'}</Text>
            </TouchableOpacity>

            <Text style={styles.response}>{responseText}</Text>
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 20, backgroundColor: '#f4f4f4' },
    button: { backgroundColor: '#3F7EFC', padding: 15, borderRadius: 10 },
    buttonText: { color: '#fff', fontWeight: 'bold' },
    response: { marginTop: 30, fontSize: 18, textAlign: 'center' },
});