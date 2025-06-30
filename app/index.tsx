import { Picker } from '@react-native-picker/picker';
import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';

export default function WelcomeScreen() {
    const [name, setName] = useState('');
    const [language, setLanguage] = useState('en');
    const router = useRouter();

    const startChat = () => {
        if (!name.trim()) return alert('Please enter your name');
        router.push({
            pathname: '/voice-chat',
            params: { name, language }
        });
    };

    return (
        <View style={styles.container}>
            <Text style={styles.label}>Your Name</Text>
            <TextInput style={styles.input} value={name} onChangeText={setName} placeholder="Enter your name" />

            <Text style={styles.label}>Select Language</Text>
            <View style={{ flexDirection: 'row', borderWidth: 1, borderColor: '#ccc', marginBottom: 20 }}>
                <Picker
                    selectedValue={language}
                    onValueChange={(lang) => setLanguage(lang)}
                    style={{ flex: 1 }}
                    itemStyle={{ fontSize: 18 }}
                >
                    <Picker.Item label="English" value="en" />
                    {/* <Picker.Item label="Arabic" value="ar" />
                    <Picker.Item label="French" value="fr" /> */}
                </Picker>
            </View>

            <TouchableOpacity style={styles.button} onPress={startChat}>
                <Text style={styles.buttonText}>Start Chat</Text>
            </TouchableOpacity>
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, justifyContent: 'center', padding: 30, backgroundColor: '#f4f4f4' },
    label: { fontSize: 18, marginBottom: 5 },
    input: { borderWidth: 1, borderColor: '#ccc', padding: 10, borderRadius: 5, marginBottom: 15 },
    button: { backgroundColor: '#3F7EFC', padding: 15, borderRadius: 10 },
    buttonText: { color: '#fff', fontWeight: 'bold', textAlign: 'center' }
});
