<template>
  <div class="login">
    <h1>Sign In</h1>
    <form @submit.prevent="handleLogin">
      <input v-model="email" type="email" placeholder="Email" required />
      <input v-model="password" type="password" placeholder="Password" required />
      <button type="submit">Login</button>
    </form>
  </div>
</template>

<script setup>
const email = ref('');
const password = ref('');

const handleLogin = () => {
  console.log('Login:', { email, password });
};
</script>
