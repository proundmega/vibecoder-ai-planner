<template>
  <div class="register">
    <h1>Create Account</h1>
    <form @submit.prevent="handleRegister">
      <input v-model="name" type="text" placeholder="Name" required />
      <input v-model="email" type="email" placeholder="Email" required />
      <input v-model="password" type="password" placeholder="Password" required />
      <button type="submit">Register</button>
    </form>
  </div>
</template>

<script setup>
const name = ref('');
const email = ref('');
const password = ref('');

const handleRegister = () => {
  console.log('Register:', { name, email, password });
};
</script>
